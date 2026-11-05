/**
 * Contratos de la sincronización offline-first.
 * La lógica (queue.ts) es pura respecto del almacenamiento y la red: recibe un OutboxStore
 * (IndexedDB en la app, memoria en los tests) y un SyncRemote (Supabase en la app, fake en tests).
 */

export type EntityName =
  | 'profiles'
  | 'user_settings'
  | 'training_plans'
  | 'training_days'
  | 'workouts'
  | 'workout_exercises'
  | 'exercise_sets'
  | 'running_sessions'
  | 'running_splits'
  | 'running_tracks'
  | 'food_items'
  | 'food_logs'
  | 'saved_meals'
  | 'water_logs'
  | 'body_measurements'
  | 'progress_photos'
  | 'exercise_favorites';

/** Orden de envío: padres antes que hijos para respetar claves foráneas. */
export const ENTITY_ORDER: Record<EntityName, number> = {
  profiles: 0,
  user_settings: 1,
  food_items: 1,
  training_plans: 2,
  training_days: 3,
  workouts: 4,
  workout_exercises: 5,
  exercise_sets: 6,
  running_sessions: 4, // referencia a training_days (3)
  running_splits: 5,
  running_tracks: 5,
  food_logs: 2,
  saved_meals: 2,
  water_logs: 2,
  body_measurements: 2,
  progress_photos: 2,
  exercise_favorites: 2,
};

/**
 * Regla de conflicto cuando el MISMO campo cambió en el servidor y en el dispositivo:
 * - newer_wins: gana la edición más reciente (registros personales de un solo autor: comidas, carreras…).
 *   La versión descartada queda registrada en el historial de conflictos.
 * - manual: se conserva la versión del servidor y se guarda la local para que el usuario elija
 *   (perfil, configuración y planes: datos "de configuración" donde no conviene adivinar).
 */
export type ConflictPolicy = 'newer_wins' | 'manual';

export const CONFLICT_POLICY: Record<EntityName, ConflictPolicy> = {
  profiles: 'manual',
  user_settings: 'manual',
  training_plans: 'manual',
  training_days: 'newer_wins',
  workouts: 'newer_wins',
  workout_exercises: 'newer_wins',
  exercise_sets: 'newer_wins',
  running_sessions: 'newer_wins',
  running_splits: 'newer_wins',
  running_tracks: 'newer_wins',
  food_items: 'newer_wins',
  food_logs: 'newer_wins',
  saved_meals: 'newer_wins',
  water_logs: 'newer_wins',
  body_measurements: 'newer_wins',
  progress_photos: 'newer_wins',
  exercise_favorites: 'newer_wins',
};

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';
export type OperationType = 'upsert' | 'delete';
export type RecordData = Record<string, unknown>;

export interface SyncOperation {
  id: string; // UUID de la operación (idempotencia en logs del servidor)
  created_at: number;
  updated_at: number; // última edición local fusionada en esta operación
  operation: OperationType;
  entity: EntityName;
  entity_id: string;
  /** Registro local completo tras el cambio. */
  payload: RecordData;
  /** Campos modificados localmente desde base_version. */
  changed_fields: string[];
  /** null = el registro se creó localmente y el servidor todavía no lo conoce. */
  base_version: number | null;
  /** Valores de changed_fields en base_version (para detectar colisiones campo a campo). */
  base_values: RecordData;
  status: SyncStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: number;
  synced_at: number | null;
}

export interface ServerRecord extends RecordData {
  id: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

export interface PushRequest {
  entity: EntityName;
  id: string;
  /** create = insert idempotente; update = update condicionado a base_version. */
  mode: 'create' | 'update';
  base_version: number | null;
  fields: RecordData;
}

export type PushResult =
  | { kind: 'applied'; record: ServerRecord }
  | { kind: 'conflict'; server: ServerRecord }
  | { kind: 'missing' } // update sobre un registro que el servidor no tiene
  | { kind: 'retry'; error: string } // red caída, timeout, 5xx
  | { kind: 'fatal'; error: string }; // validación, permisos: no se arregla reintentando ya

export interface SyncRemote {
  push(req: PushRequest): Promise<PushResult>;
}

export interface OutboxStore {
  list(): Promise<SyncOperation[]>;
  put(op: SyncOperation): Promise<void>;
  remove(id: string): Promise<void>;
}

export type ConflictResolution = 'rebased' | 'local_won' | 'server_kept' | 'deleted_remotely';

export interface ConflictEvent {
  entity: EntityName;
  entity_id: string;
  resolution: ConflictResolution;
  fields: string[];
  local: RecordData;
  server: ServerRecord;
  at: number;
}

export interface SyncHooks {
  /** El servidor confirmó: actualizar versión local del registro y marcarlo sincronizado. */
  onApplied(op: SyncOperation, record: ServerRecord): Promise<void> | void;
  /** Se conservó la versión del servidor: reemplazar el registro local por `server`. */
  onServerKept?(op: SyncOperation, server: ServerRecord): Promise<void> | void;
  onConflict?(event: ConflictEvent): Promise<void> | void;
}

export interface SyncSummary {
  synced: number;
  failed: number;
  conflicts: number;
  remaining: number;
  stopped_offline: boolean;
}
