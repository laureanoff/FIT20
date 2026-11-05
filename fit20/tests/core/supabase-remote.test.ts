import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRemote, classifyError, sanitize, type SupabaseLike } from '../../src/lib/sync/supabase-remote.ts';
import type { RecordData, ServerRecord } from '../../src/core/sync/types.ts';

/** Doble de PostgREST con la misma semántica que la base real (versión, upsert ignoreDuplicates, RLS). */
function fakeClient(opts: { failWith?: { message: string; status?: number; code?: string }; hiddenIds?: string[] } = {}) {
  const rows = new Map<string, ServerRecord>();
  const sent: RecordData[] = [];
  let clock = 0;
  const visible = (id: string) => !(opts.hiddenIds ?? []).includes(id);
  const res = <T,>(data: T) => Promise.resolve(opts.failWith ? { data: null, error: opts.failWith, status: opts.failWith.status } : { data, error: null, status: 200 });

  const client: SupabaseLike = {
    from: () => ({
      upsert: (row) => ({
        select: () => {
          sent.push(row);
          const id = String(row.id);
          if (rows.has(id) || !visible(id)) return res<ServerRecord[]>([]);
          const r = { ...row, id, version: 1, updated_at: `t${++clock}`, deleted_at: null } as ServerRecord;
          rows.set(id, r);
          return res([r]);
        },
      }),
      update: (fields) => {
        sent.push(fields);
        const f: Record<string, unknown> = {};
        const chain = {
          eq(col: string, val: unknown) { f[col] = val; return chain; },
          select() { return chain; },
          maybeSingle() { return res(null); },
          then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
            const r = rows.get(String(f.id));
            if (opts.failWith) return res(null).then(ok, ko);
            if (!r || r.version !== f.version) return res<ServerRecord[]>([]).then(ok, ko);
            Object.assign(r, fields, { version: r.version + 1, updated_at: `t${++clock}` });
            return res([r]).then(ok, ko);
          },
        };
        return chain as never;
      },
      select: () => {
        const f: Record<string, unknown> = {};
        const chain = {
          eq(col: string, val: unknown) { f[col] = val; return chain; },
          select() { return chain; },
          maybeSingle() { const id = String(f.id); return res(visible(id) ? rows.get(id) ?? null : null); },
          then(ok: (v: unknown) => unknown) { return res([...rows.values()]).then(ok); },
        };
        return chain as never;
      },
    }),
  };
  return { client, rows, sent };
}

const uid = () => 'user-1';

test('create: inserta con user_id de la sesión y sin campos del servidor', async () => {
  const { client, sent } = fakeClient();
  const r = new SupabaseRemote(client, uid);
  const res = await r.push({ entity: 'food_logs', id: 'f1', mode: 'create', base_version: null, fields: { quantity: 100, version: 7, updated_at: 'x', _sync: 'pending' } });
  assert.equal(res.kind, 'applied');
  assert.deepEqual(sent[0], { quantity: 100, id: 'f1', user_id: 'user-1' });
});

test('create repetido devuelve conflicto con la versión del servidor (no duplica)', async () => {
  const { client, rows } = fakeClient();
  const r = new SupabaseRemote(client, uid);
  await r.push({ entity: 'water_logs', id: 'w1', mode: 'create', base_version: null, fields: { quantity_ml: 250 } });
  const again = await r.push({ entity: 'water_logs', id: 'w1', mode: 'create', base_version: null, fields: { quantity_ml: 250 } });
  assert.equal(again.kind, 'conflict');
  assert.equal(rows.size, 1);
});

test('update condicionado por versión: aplica, detecta conflicto y registro inexistente', async () => {
  const { client } = fakeClient();
  const r = new SupabaseRemote(client, uid);
  await r.push({ entity: 'food_logs', id: 'f1', mode: 'create', base_version: null, fields: { quantity: 100 } });
  const ok = await r.push({ entity: 'food_logs', id: 'f1', mode: 'update', base_version: 1, fields: { quantity: 150 } });
  assert.ok(ok.kind === 'applied' && ok.record.version === 2);
  const stale = await r.push({ entity: 'food_logs', id: 'f1', mode: 'update', base_version: 1, fields: { quantity: 175 } });
  assert.ok(stale.kind === 'conflict' && stale.server.quantity === 150);
  const missing = await r.push({ entity: 'food_logs', id: 'nope', mode: 'update', base_version: 1, fields: { quantity: 1 } });
  assert.equal(missing.kind, 'missing');
});

test('perfil: no agrega user_id (el id es el usuario)', async () => {
  const { client, sent } = fakeClient();
  await new SupabaseRemote(client, uid).push({ entity: 'profiles', id: 'user-1', mode: 'create', base_version: null, fields: { full_name: 'Lau' } });
  assert.equal('user_id' in sent[0]!, false);
});

test('registro ajeno oculto por RLS → error definitivo, no conflicto', async () => {
  const { client } = fakeClient({ hiddenIds: ['x'] });
  const res = await new SupabaseRemote(client, uid).push({ entity: 'food_logs', id: 'x', mode: 'create', base_version: null, fields: {} });
  assert.equal(res.kind, 'fatal');
});

test('sin sesión o sin red → reintentar; error de datos → definitivo', async () => {
  const { client } = fakeClient();
  assert.equal((await new SupabaseRemote(client, () => null).push({ entity: 'food_logs', id: 'a', mode: 'create', base_version: null, fields: {} })).kind, 'retry');
  const offline = fakeClient({ failWith: { message: 'TypeError: Failed to fetch' } });
  assert.equal((await new SupabaseRemote(offline.client, uid).push({ entity: 'food_logs', id: 'a', mode: 'create', base_version: null, fields: {} })).kind, 'retry');
  assert.equal(classifyError({ message: 'violates check constraint', code: '23514', status: 400 }).kind, 'fatal');
  assert.equal(classifyError({ message: 'JWT expired', status: 401 }).kind, 'retry');
  assert.equal(classifyError({ message: 'busy', status: 503 }).kind, 'retry');
  assert.deepEqual(sanitize({ a: 1, b: undefined, version: 3, _local: true, point_count: 4 }), { a: 1 });
});
