import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Fit20DB } from '@/lib/db/database';
import { changedFields, saveRecord } from '@/lib/db/repository';
import { SyncEngine } from '@/lib/sync/engine';
import type { Profile } from '@/types/domain';

const UID = '11111111-1111-4111-8111-111111111111';

/** Servidor en memoria con el comportamiento de PostgREST + trigger de versión que usa la app. */
function fakeServer() {
  const tables: Record<string, Record<string, Record<string, unknown>>> = { profiles: {}, user_settings: {} };
  let clock = Date.parse('2026-11-05T12:00:00Z');
  const stamp = () => new Date((clock += 1000)).toISOString();
  const ok = <T>(data: T) => Promise.resolve({ data, error: null, status: 200 });

  const client = {
    from(table: string) {
      const rows = (tables[table] ??= {});
      return {
        upsert(row: Record<string, unknown>) {
          return {
            select: () => {
              const id = row.id as string;
              if (rows[id]) return ok([]); // ignoreDuplicates
              rows[id] = { ...row, version: 1, updated_at: stamp(), created_at: stamp() };
              return ok([rows[id]]);
            },
          };
        },
        update(fields: Record<string, unknown>) {
          const conds: [string, unknown][] = [];
          const q = {
            eq(c: string, v: unknown) {
              conds.push([c, v]);
              return q;
            },
            select() {
              const hit = Object.values(rows).find((r) => conds.every(([c, v]) => r[c] === v));
              if (!hit) return ok([]);
              Object.assign(hit, fields, { version: (hit.version as number) + 1, updated_at: stamp() });
              return ok([hit]);
            },
          };
          return q;
        },
        select() {
          const conds: [string, unknown][] = [];
          let after = '';
          const q = {
            eq(c: string, v: unknown) {
              conds.push([c, v]);
              return q;
            },
            gt(_c: string, v: string) {
              after = v;
              return q;
            },
            order() {
              return q;
            },
            limit() {
              return ok(Object.values(rows).filter((r) => (r.updated_at as string) > after).sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at))));
            },
            maybeSingle() {
              return ok(Object.values(rows).find((r) => conds.every(([c, v]) => r[c] === v)) ?? null);
            },
          };
          return q;
        },
      };
    },
  };
  return { tables, client: client as unknown as SupabaseClient, stamp };
}

const profile = (patch: Partial<Profile> = {}): Omit<Profile, 'version' | 'updated_at'> => ({
  id: UID,
  full_name: 'Lau',
  birth_date: '1995-03-10',
  sex: null,
  height_cm: 170,
  current_weight_kg: 72.5,
  target_weight_kg: 68,
  fitness_level: 'beginner',
  running_experience: 'none',
  max_run_distance_km: 0,
  training_weekdays: [1, 3, 5],
  session_minutes: 45,
  equipment: ['bodyweight'],
  dietary_preferences: [],
  dietary_restrictions: [],
  injuries: [],
  primary_goal: 'fitness',
  onboarding_completed: true,
  deleted_at: null,
  ...patch,
});

let db: Fit20DB;
beforeEach(async () => {
  db = new Fit20DB(`${UID}-${Math.random()}`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('repositorio local', () => {
  it('guarda en IndexedDB y encola una sola operación aunque se edite varias veces', async () => {
    await saveRecord(db, 'profiles', profile());
    await saveRecord(db, 'profiles', profile({ current_weight_kg: 71.8 }));
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.base_version).toBeNull();
    expect(ops[0]!.payload.current_weight_kg).toBe(71.8);
    expect((await db.profiles.get(UID))!.current_weight_kg).toBe(71.8);
  });

  it('no encola nada si no cambió ningún campo', async () => {
    await saveRecord(db, 'profiles', profile());
    expect(await saveRecord(db, 'profiles', profile())).toBe(false);
  });

  it('detecta solo los campos editados y nunca los locales ni los del servidor', () => {
    expect(changedFields({ a: 1, b: [1], version: 1 }, { a: 1, b: [1, 2], version: 2, _server_version: 3 })).toEqual(['b']);
  });
});

describe('sincronización en la app', () => {
  it('sube el perfil creado sin conexión y adopta la versión del servidor', async () => {
    const server = fakeServer();
    const engine = new SyncEngine(db, server.client, UID);
    await saveRecord(db, 'profiles', profile());
    await engine.run();

    expect(server.tables.profiles![UID]!.full_name).toBe('Lau');
    const local = (await db.profiles.get(UID))!;
    expect(local._server_version).toBe(1);
    expect(engine.getSnapshot().state).toBe('synced');
    expect((await db.outbox.toArray()).every((o) => o.status === 'synced')).toBe(true);

    // Una edición posterior viaja como update condicionado a la versión 1.
    await saveRecord(db, 'profiles', { ...local, session_minutes: 60 });
    await engine.run();
    expect(server.tables.profiles![UID]!.session_minutes).toBe(60);
    expect(server.tables.profiles![UID]!.version).toBe(2);
    expect((await db.profiles.get(UID))!._server_version).toBe(2);
  });

  it('en un dispositivo nuevo descarga el perfil existente antes del onboarding', async () => {
    const server = fakeServer();
    server.tables.profiles![UID] = { ...profile({ full_name: 'Desde otro celu' }), version: 3, updated_at: server.stamp() };
    const engine = new SyncEngine(db, server.client, UID);
    await engine.run();
    const local = (await db.profiles.get(UID))!;
    expect(local.full_name).toBe('Desde otro celu');
    expect(local._server_version).toBe(3);
    expect((await db.meta.get('initial_pull_done'))?.value).toBe(true);
  });

  it('sin backend configurado no pierde nada y lo informa', async () => {
    const engine = new SyncEngine(db, null, UID);
    await saveRecord(db, 'profiles', profile());
    await engine.run();
    expect(engine.getSnapshot().state).toBe('no-backend');
    expect(await db.outbox.where('status').equals('pending').count()).toBe(1);
  });
});
