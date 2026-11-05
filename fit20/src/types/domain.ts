/**
 * Tipos de dominio compartidos por el núcleo, la base local (IndexedDB) y la sincronización.
 * Todos los registros de usuario usan UUID y metadatos de versión para sync idempotente.
 */

export type UUID = string;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;

// ───────── Perfil ─────────

export type Sex = 'female' | 'male';
export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';
export type RunningExperience = 'none' | 'occasional' | 'regular' | 'experienced';

export type PrimaryGoal =
  | 'lose_fat'
  | 'lose_weight'
  | 'gain_muscle'
  | 'endurance'
  | 'fitness'
  | 'maintain'
  | 'recomposition';

export type Equipment =
  | 'bodyweight'
  | 'dumbbells'
  | 'bands'
  | 'weighted_backpack'
  | 'pullup_bar'
  | 'gym';

/** Regiones corporales usadas para filtrar ejercicios ante lesiones o dolor declarado. */
export type BodyRegion =
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'lower_back'
  | 'hip'
  | 'knee'
  | 'ankle'
  | 'neck';

/** Metadatos comunes a toda entidad sincronizable. */
export interface SyncMeta {
  id: UUID;
  version: number; // lo incrementa el servidor en cada update
  updated_at: ISODateTime;
  deleted_at: ISODateTime | null; // borrado lógico: nunca se pierde un registro sin confirmar
}

export interface Profile extends SyncMeta {
  full_name: string;
  birth_date: ISODate | null;
  sex: Sex | null; // opcional: solo se usa para estimaciones fisiológicas
  height_cm: number;
  current_weight_kg: number;
  target_weight_kg: number | null;
  fitness_level: FitnessLevel;
  running_experience: RunningExperience;
  max_run_distance_km: number;
  training_weekdays: number[]; // 0 = domingo … 6 = sábado
  session_minutes: number;
  equipment: Equipment[];
  dietary_preferences: string[];
  dietary_restrictions: string[];
  injuries: BodyRegion[];
  primary_goal: PrimaryGoal;
  onboarding_completed: boolean;
}

// ───────── Ejercicios ─────────

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'abs'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'full_body'
  | 'mobility'
  | 'stretching'
  | 'cardio';

export type ExerciseType = 'strength' | 'core' | 'cardio' | 'mobility' | 'stretch' | 'plyometric';

/** Patrón de movimiento: el motor arma sesiones balanceadas por patrón, no al azar. */
export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'shoulder_raise'
  | 'hip_abduction'
  | 'elbow_flexion'
  | 'elbow_extension'
  | 'calf'
  | 'core_anti_extension'
  | 'core_flexion'
  | 'core_rotation'
  | 'conditioning'
  | 'mobility'
  | 'stretch';

export interface Exercise {
  id: string; // identificador estable legible (slug)
  name: string;
  primary_muscle: MuscleGroup;
  secondary_muscles: MuscleGroup[];
  pattern: MovementPattern;
  type: ExerciseType;
  difficulty: 1 | 2 | 3;
  /** Alternativas de equipamiento: alcanza con tener UNA de ellas. */
  equipment: Equipment[];
  description: string;
  steps: string[];
  common_mistakes: string[];
  safety: string[];
  easier: string[]; // ids
  harder: string[]; // ids
  stress_regions: BodyRegion[];
  /** Ejercicio medido en segundos (plancha) en lugar de repeticiones. */
  timed?: boolean;
  unilateral?: boolean;
  image_url?: string | null;
  video_url?: string | null;
}

// ───────── Planes ─────────

export type SessionType = 'strength' | 'run' | 'strength_run' | 'active_recovery' | 'rest';
export type RunType = 'run_walk' | 'easy' | 'tempo' | 'intervals' | 'long';
export type DayStatus = 'pending' | 'started' | 'completed' | 'skipped';
export type PlanStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface PlannedExercise {
  exercise_id: string;
  sets: number;
  reps: string; // "8-12", "30 s", "10 por lado"
  rest_seconds: number;
  rpe: number; // esfuerzo percibido orientativo 1–10
  notes?: string;
}

export interface PlannedRun {
  type: RunType;
  distance_km: number;
  duration_min: number;
  intensity: string;
  instructions: string[];
}

export interface PlannedDay {
  day_number: number;
  date: ISODate;
  session_type: SessionType;
  title: string;
  focus: MuscleGroup[];
  estimated_minutes: number;
  intensity: string;
  exercises: PlannedExercise[];
  run: PlannedRun | null;
  instructions: string[];
  week_index: number;
  is_deload: boolean;
}

export interface PlanInput {
  goal: PrimaryGoal;
  level: FitnessLevel;
  training_weekdays: number[];
  session_minutes: number;
  equipment: Equipment[];
  focus_muscles: MuscleGroup[];
  running: {
    include: boolean;
    experience: RunningExperience;
    max_distance_km: number;
  };
  injuries: BodyRegion[];
  duration_days: number;
  start_date: ISODate;
}

// ───────── Nutrición ─────────

export type FoodState = 'raw' | 'cooked' | 'na';
export type MealType = 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'extra' | 'drink';

export interface FoodItem {
  id: string;
  name: string;
  category: string;
  state: FoodState;
  /** Valores por 100 g (o 100 ml en líquidos). */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Porciones comunes en gramos, p. ej. { unidad: 50 } para un huevo. */
  portions: Record<string, number>;
  is_liquid?: boolean;
  user_id?: UUID | null; // null = base global
}

export interface MacroTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}
