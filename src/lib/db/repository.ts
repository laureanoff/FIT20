import { enqueue } from '@/core/sync/queue';
import type { EntityName, OutboxStore, RecordData, ServerRecord, SyncOperation } from '@/core/sync/types';
import { newId } from '@/lib/id';
import { type Fit20DB, type LocalEntity, tableFor } from './database';

/** Cola de sincronización sobre IndexedDB (implementa el contrato del núcleo). */
export function outboxStore(db: Fit20DB): OutboxStore {
  return {
    list: () => db.outbox.toArray(),
    put: async (op: SyncOperation) => {
      await db.outbox.put(op);
    },
    remove: (id: string) => db.outbox.delete(id),
  };
}

const NOT_TRACKED = new Set(['version', 'updated_at', 'created_at']);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Campos editados por el usuario entre dos versiones locales del registro. */
export function changedFields(prev: RecordData | undefined, next: RecordData): string[] {
  return Object.keys(next).filter((k) => !NOT_TRACKED.has(k) && !k.startsWith('_') && (!prev || !same(prev[k], next[k])));
}

type Stored = { id: string; version: number; updated_at: string; _server_version: number | null } & RecordData;

/** Lo que la UI entrega al guardar: el registro sin metadatos de versión. */
export type Draft<T> = Omit<T, 'version' | 'updated_at'> & { version?: number; updated_at?: string };

export interface PendingWrite {
  entity: LocalEntity;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record: { id: string; [k: string]: any };
}

/** Escribe un registro y su operación. Debe llamarse dentro de una transacción que incluya la tabla y el outbox. */
async function stage(db: Fit20DB, entity: LocalEntity, next: PendingWrite['record'], now: number): Promise<boolean> {
  const table = tableFor(db, entity);
  const prev = (await table.get(next.id)) as Stored | undefined;
  const record = {
    ...prev,
    ...next,
    version: prev?.version ?? 0,
    _server_version: prev?._server_version ?? null,
    updated_at: new Date(now).toISOString(),
  } as Stored;
  const fields = changedFields(prev, record);
  if (prev && fields.length === 0) return false;

  const base_values: RecordData = {};
  if (prev) for (const f of fields) base_values[f] = prev[f];

  await table.put(record);
  await enqueue(
    outboxStore(db),
    {
      operation: 'upsert',
      entity: entity as EntityName,
      entity_id: record.id,
      record: stripLocal(record),
      changed_fields: fields,
      base_version: record._server_version,
      base_values,
    },
    now,
    newId,
  );
  return true;
}

/**
 * Guarda un registro: escribe en IndexedDB (la UI lo ve al instante) y encola la operación
 * en la MISMA transacción, así nunca queda un cambio local sin su operación de sincronización.
 * Devuelve false si no había nada que cambiar.
 */
export async function saveRecord(db: Fit20DB, entity: LocalEntity, next: PendingWrite['record']): Promise<boolean> {
  return saveRecords(db, [{ entity, record: next }]).then((n) => n > 0);
}

/** Varios registros en una sola transacción (todo o nada). Devuelve cuántos cambiaron. */
export async function saveRecords(db: Fit20DB, writes: PendingWrite[]): Promise<number> {
  if (!writes.length) return 0;
  const tables = [...new Set(writes.map((w) => w.entity))].map((e) => tableFor(db, e));
  return db.transaction('rw', [...tables, db.outbox], async () => {
    const now = Date.now();
    let n = 0;
    for (const w of writes) if (await stage(db, w.entity, w.record, now)) n++;
    return n;
  });
}

export function stripLocal(rec: RecordData): RecordData {
  const out: RecordData = {};
  for (const [k, v] of Object.entries(rec)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

/** El servidor confirmó: adoptar su versión sin pisar ediciones locales posteriores. */
export async function markApplied(db: Fit20DB, entity: LocalEntity, server: ServerRecord): Promise<void> {
  const table = tableFor(db, entity);
  await db.transaction('rw', table, async () => {
    const local = (await table.get(server.id)) as Stored | undefined;
    if (!local) return;
    await table.put({ ...local, version: server.version, _server_version: server.version });
  });
}

/** Reemplaza el registro local por el del servidor (conflicto resuelto a favor del servidor o descarga). */
export async function replaceWithServer(db: Fit20DB, entity: LocalEntity, server: ServerRecord): Promise<void> {
  await tableFor(db, entity).put({ ...server, _server_version: server.version });
}
