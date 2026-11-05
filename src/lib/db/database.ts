import Dexie, { type Table } from 'dexie';
import type { DayStatus, MealType, PlanInput, PlanStatus, PlannedDay, Profile, SessionType } from '@/types/domain';
import type { ConflictEvent, SyncOperation } from '@/core/sync/types';

/**
 * Metadatos solo-dispositivo. Los campos que empiezan con "_" nunca se envían al servidor
 * (ver `sanitize` en lib/sync/supabase-remote.ts).
 */
export interface LocalMeta {
  /** Versión que el servidor confirmó por última vez; null = el servidor todavía no conoce el registro. */
  _server_version: number | null;
}

interface Synced {
  id: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

export type ThemePreference = 'dark' | 'light' | 'system';

export interface UserSettings extends Synced {
  user_id: string;
  theme: ThemePreference;
  units: 'metric' | 'imperial';
  notifications_enabled: boolean;
  sound_enabled: boolean;
  vibration_enabled: boolean;
  default_rest_seconds: number;
  reminders: unknown[];
  offline_enabled: boolean;
  nutrition_targets: Record<string, number> | null;
}

// ───────── Entrenamiento (espejo de las tablas de Supabase) ─────────

export interface TrainingPlan extends Synced {
  user_id: string;
  name: string;
  goal: string;
  input: PlanInput;
  duration_days: number;
  start_date: string;
  end_date: string;
  status: PlanStatus;
  paused_at: string | null;
}

export interface ReadinessRecord {
  fatigue: number;
  pain_regions: string[];
  changes: string[];
  warnings: string[];
  recommend_professional: boolean;
  reported_at: string;
}

export interface TrainingDay extends Synced {
  user_id: string;
  plan_id: string;
  date: string;
  day_number: number;
  session_type: SessionType;
  status: DayStatus;
  planned: PlannedDay;
  readiness: ReadinessRecord | null;
  notes: string | null;
}

export type WorkoutStatus = 'started' | 'completed' | 'abandoned';

export interface Workout extends Synced {
  user_id: string;
  training_day_id: string | null;
  name: string;
  category: string;
  estimated_duration_min: number | null;
  status: WorkoutStatus;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  rpe: number | null;
  notes: string | null;
}

export interface WorkoutExercise extends Synced {
  user_id: string;
  workout_id: string;
  exercise_id: string;
  order_index: number;
  sets: number;
  repetitions: string;
  rest_seconds: number;
}

export interface ExerciseSet extends Synced {
  user_id: string;
  workout_exercise_id: string;
  set_number: number;
  repetitions_completed: number | null;
  duration_seconds: number | null;
  weight_kg: number | null;
  completed_at: string;
}

export interface ExerciseFavorite extends Synced {
  user_id: string;
  exercise_id: string;
}

// ───────── Running ─────────

export interface RunningSession extends Synced {
  user_id: string;
  training_day_id: string | null;
  session_date: string;
  started_at: string | null;
  run_type: string | null;
  source: 'gps' | 'manual';
  distance_km: number;
  duration_seconds: number;
  target_distance_km: number | null;
  target_duration_seconds: number | null;
  rpe: number | null;
  notes: string | null;
}

export interface RunningSplit extends Synced {
  user_id: string;
  session_id: string;
  kilometer: number;
  duration_seconds: number;
}

/** points = [[lat, lng, elapsed_ms, accuracy, segment], …] (formato compacto del servidor). */
export type TrackPoint = [number, number, number, number, number];

export interface RunningTrack extends Synced {
  user_id: string;
  session_id: string;
  points: TrackPoint[];
}

/** Punto crudo de la carrera en curso (solo en el dispositivo, nunca se sincroniza). */
export interface LivePoint {
  seq?: number;
  lat: number;
  lng: number;
  accuracy: number;
  elapsed_ms: number;
  segment: number;
}

// ───────── Nutrición ─────────

/** Alimento propio del usuario (los globales viven en src/data/foods). */
export interface CustomFood extends Synced {
  owner_id: string | null;
  name: string;
  brand: string | null;
  category: string;
  state: 'raw' | 'cooked' | 'na';
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  portions: Record<string, number>;
  is_liquid: boolean;
}

export interface FoodLog extends Synced {
  user_id: string;
  food_item_id: string;
  log_date: string;
  meal_type: MealType;
  quantity: number;
  unit: string;
  grams: number;
  food_name: string;
  calories: number;
  protein: number;
  carbohydrates: number;
  fats: number;
  logged_at: string;
}

export interface SavedMealItem {
  food_item_id: string;
  quantity: number;
  unit: string;
}

export interface SavedMeal extends Synced {
  user_id: string;
  name: string;
  items: SavedMealItem[];
}

export interface WaterLog extends Synced {
  user_id: string;
  log_date: string;
  quantity_ml: number;
  logged_at: string;
}

export type L<T> = T & LocalMeta;
export type LocalProfile = L<Profile>;
export type LocalSettings = L<UserSettings>;

export interface StoredConflict extends ConflictEvent {
  seq?: number;
  seen: boolean;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/**
 * Una base IndexedDB por usuario: en un dispositivo compartido nadie ve datos ni
 * operaciones pendientes de otra cuenta, y cerrar sesión no mezcla colas.
 */
export class Fit20DB extends Dexie {
  profiles!: Table<LocalProfile, string>;
  user_settings!: Table<LocalSettings, string>;
  training_plans!: Table<L<TrainingPlan>, string>;
  training_days!: Table<L<TrainingDay>, string>;
  workouts!: Table<L<Workout>, string>;
  workout_exercises!: Table<L<WorkoutExercise>, string>;
  exercise_sets!: Table<L<ExerciseSet>, string>;
  exercise_favorites!: Table<L<ExerciseFavorite>, string>;
  running_sessions!: Table<L<RunningSession>, string>;
  running_splits!: Table<L<RunningSplit>, string>;
  running_tracks!: Table<L<RunningTrack>, string>;
  live_points!: Table<LivePoint, number>;
  food_items!: Table<L<CustomFood>, string>;
  food_logs!: Table<L<FoodLog>, string>;
  saved_meals!: Table<L<SavedMeal>, string>;
  water_logs!: Table<L<WaterLog>, string>;
  outbox!: Table<SyncOperation, string>;
  conflicts!: Table<StoredConflict, number>;
  meta!: Table<MetaEntry, string>;

  constructor(userId: string) {
    super(`fit20-${userId}`);
    this.version(1).stores({
      profiles: 'id',
      user_settings: 'id, user_id',
      outbox: 'id, status, [entity+entity_id]',
      conflicts: '++seq, entity, seen',
      meta: 'key',
    });
    this.version(2).stores({
      training_plans: 'id, status, start_date',
      training_days: 'id, plan_id, date, [plan_id+date]',
      workouts: 'id, training_day_id, status, started_at',
      workout_exercises: 'id, workout_id, exercise_id',
      exercise_sets: 'id, workout_exercise_id',
      exercise_favorites: 'id, exercise_id',
    });
    this.version(3).stores({
      running_sessions: 'id, session_date, training_day_id',
      running_splits: 'id, session_id',
      running_tracks: 'id, session_id',
      live_points: '++seq',
    });
    this.version(4).stores({
      food_items: 'id, owner_id',
      food_logs: 'id, log_date, food_item_id',
      saved_meals: 'id',
      water_logs: 'id, log_date',
    });
  }
}

/** Tablas sincronizables presentes en la base local, en orden padre → hijo. */
export const LOCAL_ENTITIES = [
  'profiles',
  'user_settings',
  'food_items',
  'exercise_favorites',
  'training_plans',
  'training_days',
  'workouts',
  'workout_exercises',
  'exercise_sets',
  'running_sessions',
  'running_splits',
  'running_tracks',
  'food_logs',
  'saved_meals',
  'water_logs',
] as const;
export type LocalEntity = (typeof LOCAL_ENTITIES)[number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tableFor(db: Fit20DB, entity: LocalEntity): Table<any, string> {
  return db.table(entity);
}

let current: Fit20DB | null = null;

export function openUserDB(userId: string): Fit20DB {
  if (current && current.name === `fit20-${userId}`) return current;
  current?.close();
  current = new Fit20DB(userId);
  return current;
}

export function closeUserDB(): void {
  current?.close();
  current = null;
}

export async function getMeta<T>(db: Fit20DB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(db: Fit20DB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Registros vivos (sin borrado lógico). */
export const alive = <T extends { deleted_at: string | null }>(r: T | undefined | null): r is T => !!r && !r.deleted_at;
