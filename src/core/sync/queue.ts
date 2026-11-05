import {
  CONFLICT_POLICY,
  ENTITY_ORDER,
  type ConflictEvent,
  type EntityName,
  type OperationType,
  type OutboxStore,
  type PushRequest,
  type RecordData,
  type ServerRecord,
  type SyncHooks,
  type SyncOperation,
  type SyncRemote,
  type SyncSummary,
} from './types.ts';

export const MAX_ATTEMPTS = 10;
const MAX_REBASES = 3;

/** Espera exponencial: 5 s, 10 s, 20 s… hasta 30 min. */
export function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

export interface LocalChange {
  operation: OperationType;
  entity: EntityName;
  entity_id: string;
  record: RecordData;
  changed_fields: string[];
  /** Versión del servidor sobre la que se editó (null si el registro es nuevo y nunca se sincronizó). */
  base_version: number | null;
  /** Valores previos de changed_fields (antes de editar). */
  base_values: RecordData;
}

const isOpen = (op: SyncOperation) => op.status === 'pending' || op.status === 'error';

/**
 * Registra un cambio local en la cola. Varios cambios sobre el mismo registro antes de
 * sincronizar se fusionan en UNA operación (menos tráfico y sin estados intermedios en el servidor).
 */
export async function enqueue(store: OutboxStore, change: LocalChange, now: number, newId: () => string): Promise<SyncOperation | null> {
  const all = await store.list();
  const existing = all.find((op) => isOpen(op) && op.entity === change.entity && op.entity_id === change.entity_id);

  if (existing) {
    // Creado y borrado sin haber llegado nunca al servidor: no hay nada que sincronizar.
    if (change.operation === 'delete' && existing.base_version === null && existing.attempts === 0) {
      await store.remove(existing.id);
      return null;
    }
    const merged: SyncOperation = {
      ...existing,
      operation: change.operation === 'delete' ? 'delete' : existing.operation,
      payload: change.record,
      changed_fields: [...new Set([...existing.changed_fields, ...change.changed_fields])],
      // Conservar el valor base MÁS ANTIGUO de cada campo.
      base_values: { ...change.base_values, ...existing.base_values },
      updated_at: now,
      status: 'pending',
      next_attempt_at: now,
    };
    await store.put(merged);
    return merged;
  }

  const op: SyncOperation = {
    id: newId(),
    created_at: now,
    updated_at: now,
    operation: change.operation,
    entity: change.entity,
    entity_id: change.entity_id,
    payload: change.record,
    changed_fields: change.changed_fields,
    base_version: change.base_version,
    base_values: change.base_values,
    status: 'pending',
    attempts: 0,
    last_error: null,
    next_attempt_at: now,
    synced_at: null,
  };
  await store.put(op);
  return op;
}

/** Al iniciar la app: operaciones que quedaron "sincronizando" por un cierre abrupto vuelven a pendientes. */
export async function recoverInterrupted(store: OutboxStore): Promise<number> {
  let n = 0;
  for (const op of await store.list()) {
    if (op.status === 'syncing') {
      await store.put({ ...op, status: 'pending' });
      n++;
    }
  }
  return n;
}

/** Reintento manual pedido por el usuario: reinicia contadores de las operaciones con error. */
export async function retryFailed(store: OutboxStore, now: number): Promise<number> {
  let n = 0;
  for (const op of await store.list()) {
    if (op.status === 'error') {
      await store.put({ ...op, status: 'pending', attempts: 0, next_attempt_at: now });
      n++;
    }
  }
  return n;
}

/** Limpia del historial las operaciones confirmadas hace más de `maxAgeMs`. */
export async function pruneSynced(store: OutboxStore, now: number, maxAgeMs = 24 * 3600_000): Promise<void> {
  for (const op of await store.list()) {
    if (op.status === 'synced' && op.synced_at !== null && now - op.synced_at > maxAgeMs) await store.remove(op.id);
  }
}

export async function queueStats(store: OutboxStore): Promise<{ pending: number; error: number; syncing: number; synced: number }> {
  const s = { pending: 0, error: 0, syncing: 0, synced: 0 };
  for (const op of await store.list()) s[op.status]++;
  return s;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function pick(rec: RecordData, fields: string[]): RecordData {
  const out: RecordData = {};
  for (const f of fields) if (f in rec) out[f] = rec[f];
  return out;
}

function deletionFields(now: number): RecordData {
  return { deleted_at: new Date(now).toISOString() };
}

function initialRequest(op: SyncOperation, now: number): PushRequest {
  if (op.base_version === null) {
    const fields = op.operation === 'delete' ? { ...op.payload, ...deletionFields(now) } : op.payload;
    return { entity: op.entity, id: op.entity_id, mode: 'create', base_version: null, fields };
  }
  const fields = op.operation === 'delete' ? deletionFields(now) : pick(op.payload, op.changed_fields);
  return { entity: op.entity, id: op.entity_id, mode: 'update', base_version: op.base_version, fields };
}

/**
 * Procesa la cola. Garantías:
 * - Idempotente: reenviar una operación ya aplicada no duplica registros (insert por UUID).
 * - Orden padre → hijo.
 * - Ante error de red se detiene (probablemente sin conexión) y reintenta con backoff.
 * - La operación sale de la cola recién cuando el servidor confirma.
 * - Nunca sobrescribe en silencio un dato más reciente del servidor.
 */
export async function processQueue(store: OutboxStore, remote: SyncRemote, hooks: SyncHooks, now: () => number): Promise<SyncSummary> {
  const summary: SyncSummary = { synced: 0, failed: 0, conflicts: 0, remaining: 0, stopped_offline: false };
  const ops = (await store.list())
    .filter((op) => isOpen(op) && op.attempts < MAX_ATTEMPTS && op.next_attempt_at <= now())
    .sort((a, b) => ENTITY_ORDER[a.entity] - ENTITY_ORDER[b.entity] || a.created_at - b.created_at);

  for (const queued of ops) {
    // Releer: la operación pudo fusionarse con un cambio nuevo mientras procesábamos otra.
    const fresh = (await store.list()).find((o) => o.id === queued.id);
    if (!fresh || !isOpen(fresh)) continue;
    let op: SyncOperation = { ...fresh, status: 'syncing' };
    await store.put(op);

    let req = initialRequest(op, now());
    let outcome: 'done' | 'retry' | 'fatal' = 'fatal';
    let errorMsg = '';

    for (let rebase = 0; rebase <= MAX_REBASES; rebase++) {
      const res = await remote.push(req);

      if (res.kind === 'applied') {
        await hooks.onApplied(op, res.record);
        outcome = 'done';
        break;
      }
      if (res.kind === 'retry') {
        outcome = 'retry';
        errorMsg = res.error;
        break;
      }
      if (res.kind === 'fatal') {
        outcome = 'fatal';
        errorMsg = res.error;
        break;
      }
      if (res.kind === 'missing') {
        // El servidor no tiene el registro (p. ej. base local restaurada): crearlo completo.
        req = { entity: op.entity, id: op.entity_id, mode: 'create', base_version: null, fields: op.operation === 'delete' ? { ...op.payload, ...deletionFields(now()) } : op.payload };
        continue;
      }

      // ── Conflicto ──
      const server = res.server;
      const next = resolveConflict(op, server, req, now());
      if (next.event) {
        summary.conflicts++;
        await hooks.onConflict?.(next.event);
      }
      if (next.action === 'server_kept') {
        await hooks.onServerKept?.(op, server);
        outcome = 'done';
        break;
      }
      if (next.action === 'already_applied') {
        await hooks.onApplied(op, server);
        outcome = 'done';
        break;
      }
      req = next.request!;
      if (rebase === MAX_REBASES) {
        outcome = 'retry';
        errorMsg = 'El registro cambia muy seguido en el servidor; se reintentará.';
      }
    }

    // Ediciones hechas DURANTE el envío no se fusionan con esta operación (está "sincronizando"):
    // generan una operación nueva cuya base es anterior; al subir, el rebase la combina sin pérdida.
    if (outcome === 'done') {
      summary.synced++;
      await store.put({ ...op, status: 'synced', synced_at: now(), last_error: null });
    } else {
      const attempts = op.attempts + 1;
      summary.failed++;
      op = { ...op, status: 'error', attempts, last_error: errorMsg, next_attempt_at: now() + backoffMs(attempts) * (outcome === 'fatal' ? 4 : 1) };
      await store.put(op);
      if (outcome === 'retry') {
        summary.stopped_offline = true;
        break;
      }
    }
  }

  summary.remaining = (await store.list()).filter(isOpen).length;
  return summary;
}

interface Resolution {
  action: 'retry_with' | 'server_kept' | 'already_applied';
  request?: PushRequest;
  event?: ConflictEvent;
}

function resolveConflict(op: SyncOperation, server: ServerRecord, prev: PushRequest, now: number): Resolution {
  const local = op.payload;

  // Creación reenviada (p. ej. tras un timeout): el registro ya existe.
  if (prev.mode === 'create') {
    if (server.version === 1 || op.changed_fields.every((f) => same(server[f], local[f]))) {
      const pending = Object.keys(local).filter((k) => !['version', 'updated_at', 'created_at'].includes(k) && !same(server[k], local[k]));
      if (pending.length === 0) return { action: 'already_applied' };
      // Lo creamos nosotros y nadie más lo tocó: aplicar el resto de nuestros cambios.
      return { action: 'retry_with', request: { ...prev, mode: 'update', base_version: server.version, fields: pick(local, pending) } };
    }
  }

  // Borrado en otro dispositivo.
  if (server.deleted_at && op.operation !== 'delete') {
    return {
      action: 'server_kept',
      event: { entity: op.entity, entity_id: op.entity_id, resolution: 'deleted_remotely', fields: op.changed_fields, local, server, at: now },
    };
  }
  if (server.deleted_at && op.operation === 'delete') return { action: 'already_applied' };

  const fields = op.operation === 'delete' ? ['deleted_at'] : op.changed_fields;
  const collisions =
    op.operation === 'delete'
      ? [] // borrar sobre una versión más nueva: se decide abajo por política
      : fields.filter((f) => !same(server[f], op.base_values[f]) && !same(server[f], local[f]));

  const serverNewerEdit = op.operation === 'delete' && server.version !== op.base_version;

  if (collisions.length === 0 && !serverNewerEdit) {
    // Cambios en campos distintos: se combinan (rebase sobre la versión del servidor).
    const stillDifferent = op.operation === 'delete' ? fields : fields.filter((f) => !same(server[f], local[f]));
    if (stillDifferent.length === 0) return { action: 'already_applied' };
    return {
      action: 'retry_with',
      request: { ...prev, mode: 'update', base_version: server.version, fields: op.operation === 'delete' ? deletionFields(now) : pick(local, stillDifferent) },
    };
  }

  const policy = CONFLICT_POLICY[op.entity];
  const localNewer = op.updated_at > Date.parse(server.updated_at);
  const conflictFields = collisions.length ? collisions : fields;

  if (policy === 'newer_wins' && localNewer) {
    return {
      action: 'retry_with',
      request: { ...prev, mode: 'update', base_version: server.version, fields: op.operation === 'delete' ? deletionFields(now) : pick(local, fields) },
      event: { entity: op.entity, entity_id: op.entity_id, resolution: 'local_won', fields: conflictFields, local, server, at: now },
    };
  }
  return {
    action: 'server_kept',
    event: { entity: op.entity, entity_id: op.entity_id, resolution: 'server_kept', fields: conflictFields, local, server, at: now },
  };
}

/** Al descargar cambios del servidor: ¿qué hacer con el registro local? */
export function resolvePulled(
  local: { version: number } | undefined,
  server: { version: number },
  hasOpenOperation: boolean,
): 'insert' | 'replace' | 'keep' {
  if (!local) return hasOpenOperation ? 'keep' : 'insert';
  if (hasOpenOperation) return 'keep'; // la cola resolverá el conflicto al subir
  return server.version > local.version ? 'replace' : 'keep';
}
