import type { EntityName, PushRequest, PushResult, RecordData, ServerRecord, SyncRemote } from '../../core/sync/types.ts';

/**
 * Subconjunto estructural del cliente de supabase-js que usa la sincronización.
 * Tiparlo así permite testear el adaptador sin red y sin depender de la versión exacta del SDK.
 */
export interface PgError {
  message: string;
  code?: string;
  status?: number;
}
type Res<T> = PromiseLike<{ data: T | null; error: PgError | null; status?: number }>;

interface Filter<T> extends Res<T> {
  eq(col: string, val: unknown): Filter<T>;
  select(cols?: string): Filter<T>;
  maybeSingle(): Res<T extends (infer U)[] ? U : T>;
}

export interface SupabaseLike {
  from(table: string): {
    upsert(row: RecordData, opts: { onConflict: string; ignoreDuplicates: boolean }): { select(cols?: string): Res<ServerRecord[]> };
    update(fields: RecordData): Filter<ServerRecord[]>;
    select(cols?: string): Filter<ServerRecord[]>;
  };
}

/** Campos que maneja el servidor o que solo existen en el dispositivo: nunca se envían. */
const SERVER_MANAGED = new Set(['version', 'created_at', 'updated_at', 'average_pace_s', 'point_count']);

export function sanitize(fields: RecordData): RecordData {
  const out: RecordData = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SERVER_MANAGED.has(k) || k.startsWith('_') || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Clasifica errores: los transitorios (red, 5xx, 401 por token vencido, 429) se reintentan pronto;
 * los de datos/permisos (4xx de PostgREST) esperan más (pueden resolverse cuando suba el registro padre).
 */
export function classifyError(err: PgError, status?: number): PushResult {
  const s = err.status ?? status ?? 0;
  const msg = err.message || 'Error desconocido';
  const network = /fetch|network|timeout|abort|load failed/i.test(msg) || s === 0;
  if (network || s >= 500 || s === 401 || s === 408 || s === 429) return { kind: 'retry', error: msg };
  return { kind: 'fatal', error: err.code ? `${err.code}: ${msg}` : msg };
}

/** Tablas cuyo dueño se expresa con `id` (perfil) en lugar de `user_id`. */
const ID_IS_OWNER = new Set<EntityName>(['profiles']);

export class SupabaseRemote implements SyncRemote {
  constructor(private readonly client: SupabaseLike, private readonly userId: () => string | null) {}

  async push(req: PushRequest): Promise<PushResult> {
    const uid = this.userId();
    if (!uid) return { kind: 'retry', error: 'Sin sesión iniciada' };
    const table = this.client.from(req.entity);

    try {
      if (req.mode === 'create') {
        const row = sanitize({ ...req.fields, id: req.id });
        if (!ID_IS_OWNER.has(req.entity) && !('owner_id' in row)) row.user_id = uid;
        const ins = await table.upsert(row, { onConflict: 'id', ignoreDuplicates: true }).select();
        if (ins.error) return classifyError(ins.error, ins.status);
        if (ins.data && ins.data.length === 1) return { kind: 'applied', record: ins.data[0]! };
        // Ya existía: devolver la versión del servidor para que la cola decida.
        return this.currentOr(req, { kind: 'fatal', error: 'El registro existe pero no es accesible para este usuario.' });
      }

      const upd = await table.update(sanitize(req.fields)).eq('id', req.id).eq('version', req.base_version).select();
      if (upd.error) return classifyError(upd.error, upd.status);
      if (upd.data && upd.data.length === 1) return { kind: 'applied', record: upd.data[0]! };
      return this.currentOr(req, { kind: 'missing' });
    } catch (e) {
      return { kind: 'retry', error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async currentOr(req: PushRequest, fallback: PushResult): Promise<PushResult> {
    const cur = await this.client.from(req.entity).select().eq('id', req.id).maybeSingle();
    if (cur.error) return classifyError(cur.error, cur.status);
    return cur.data ? { kind: 'conflict', server: cur.data } : fallback;
  }
}
