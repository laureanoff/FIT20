import type { FitnessLevel, MovementPattern, MuscleGroup, PrimaryGoal, RunningExperience } from '../../types/domain.ts';

/**
 * Reglas de entrenamiento explícitas. Todo lo que el motor decide sale de acá,
 * para que sea auditable y testeable (nada aleatorio).
 */

export interface GoalPrescription {
  reps: string;
  rest_seconds: number;
  rpe: number;
  /** Proporción de días de calidad dedicados a correr cuando el usuario incluye running. */
  run_share: number;
  label: string;
}

export const GOAL_RX: Record<PrimaryGoal, GoalPrescription> = {
  gain_muscle: { reps: '8-12', rest_seconds: 90, rpe: 8, run_share: 0.2, label: 'Hipertrofia' },
  recomposition: { reps: '8-12', rest_seconds: 75, rpe: 8, run_share: 0.34, label: 'Recomposición' },
  lose_fat: { reps: '10-15', rest_seconds: 60, rpe: 7, run_share: 0.4, label: 'Pérdida de grasa' },
  lose_weight: { reps: '10-15', rest_seconds: 60, rpe: 7, run_share: 0.45, label: 'Bajar de peso' },
  endurance: { reps: '12-15', rest_seconds: 45, rpe: 7, run_share: 0.6, label: 'Resistencia' },
  fitness: { reps: '10-12', rest_seconds: 60, rpe: 7, run_share: 0.4, label: 'Condición física' },
  maintain: { reps: '8-12', rest_seconds: 75, rpe: 7, run_share: 0.34, label: 'Mantenimiento' },
};

export interface LevelRules {
  base_sets: number;
  max_sets: number;
  /** Días exigentes máximos por semana; los días extra elegidos pasan a recuperación activa. */
  max_hard_days: number;
  max_difficulty: 1 | 2 | 3;
  allow_plyometrics: boolean;
}

export const LEVEL_RULES: Record<FitnessLevel, LevelRules> = {
  beginner: { base_sets: 2, max_sets: 3, max_hard_days: 4, max_difficulty: 1, allow_plyometrics: false },
  intermediate: { base_sets: 3, max_sets: 4, max_hard_days: 5, max_difficulty: 2, allow_plyometrics: false },
  advanced: { base_sets: 3, max_sets: 5, max_hard_days: 6, max_difficulty: 3, allow_plyometrics: true },
};

/**
 * Mesociclo de 4 semanas: 3 de carga progresiva + 1 de descarga.
 * La descarga reduce volumen ~40% y baja el RPE para consolidar la adaptación.
 */
export const MESOCYCLE_WEEKS = 4;
export const RUN_WEEKLY_GROWTH = 0.08; // < 10% semanal (regla clásica de prevención de lesiones)
export const RUN_MAX_GROWTH_FACTOR = 1.6;
export const DELOAD_FACTOR = 0.7;

export function isDeloadWeek(weekIndex: number): boolean {
  return weekIndex % MESOCYCLE_WEEKS === MESOCYCLE_WEEKS - 1;
}

/** Series para una semana dada: base, base, base+1, descarga. */
export function setsForWeek(level: FitnessLevel, weekIndex: number): number {
  const r = LEVEL_RULES[level];
  const pos = weekIndex % MESOCYCLE_WEEKS;
  if (pos === 3) return Math.max(1, r.base_sets - 1);
  if (pos === 2) return Math.min(r.max_sets, r.base_sets + 1);
  return r.base_sets;
}

/** Ritmo cómodo estimado (seg/km) para convertir distancia ↔ tiempo. */
export const EASY_PACE_SEC: Record<RunningExperience, number> = {
  none: 8.5 * 60,
  occasional: 7.5 * 60,
  regular: 6.5 * 60,
  experienced: 5.75 * 60,
};

// ───────── Plantillas de sesión de fuerza ─────────

export type Split = 'full' | 'upper' | 'lower' | 'push' | 'pull' | 'legs';

export interface Slot {
  patterns: MovementPattern[];
  muscle?: MuscleGroup;
  optional?: boolean; // se agrega solo si alcanza el tiempo
}

export const SPLIT_SLOTS: Record<Split, Slot[]> = {
  full: [
    { patterns: ['squat', 'lunge'] },
    { patterns: ['horizontal_push'] },
    { patterns: ['hinge'] },
    { patterns: ['horizontal_pull', 'vertical_pull'] },
    { patterns: ['core_anti_extension', 'core_rotation'] },
    { patterns: ['vertical_push'], optional: true },
    { patterns: ['lunge'], optional: true },
    { patterns: ['calf'], optional: true },
  ],
  upper: [
    { patterns: ['horizontal_push'] },
    { patterns: ['horizontal_pull'] },
    { patterns: ['vertical_push'] },
    { patterns: ['vertical_pull', 'horizontal_pull'] },
    { patterns: ['elbow_flexion'], optional: true },
    { patterns: ['elbow_extension'], optional: true },
    { patterns: ['shoulder_raise'], optional: true },
    { patterns: ['core_rotation', 'core_anti_extension'], optional: true },
  ],
  lower: [
    { patterns: ['squat'] },
    { patterns: ['hinge'] },
    { patterns: ['lunge'] },
    { patterns: ['core_anti_extension', 'core_flexion'] },
    { patterns: ['calf'], optional: true },
    { patterns: ['hip_abduction'], optional: true },
    { patterns: ['hinge'], muscle: 'glutes', optional: true },
  ],
  push: [
    { patterns: ['horizontal_push'] },
    { patterns: ['vertical_push'] },
    { patterns: ['horizontal_push'] },
    { patterns: ['elbow_extension'] },
    { patterns: ['shoulder_raise'], optional: true },
    { patterns: ['core_anti_extension'], optional: true },
  ],
  pull: [
    { patterns: ['vertical_pull'] },
    { patterns: ['horizontal_pull'] },
    { patterns: ['horizontal_pull'], muscle: 'shoulders' },
    { patterns: ['elbow_flexion'] },
    { patterns: ['core_rotation', 'core_flexion'], optional: true },
  ],
  legs: [
    { patterns: ['squat'] },
    { patterns: ['hinge'] },
    { patterns: ['lunge'] },
    { patterns: ['calf'] },
    { patterns: ['hip_abduction'], optional: true },
    { patterns: ['core_anti_extension', 'core_flexion'], optional: true },
  ],
};

/** Grupos musculares principales que carga cada split (para la regla de recuperación). */
export const SPLIT_MUSCLES: Record<Split, MuscleGroup[]> = {
  full: ['quads', 'glutes', 'hamstrings', 'chest', 'back', 'shoulders'],
  upper: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
  lower: ['quads', 'glutes', 'hamstrings', 'calves'],
  push: ['chest', 'shoulders', 'triceps'],
  pull: ['back', 'biceps'],
  legs: ['quads', 'glutes', 'hamstrings', 'calves'],
};

export const SPLIT_TITLES: Record<Split, string> = {
  full: 'Fuerza · Cuerpo completo',
  upper: 'Fuerza · Tren superior',
  lower: 'Fuerza · Tren inferior',
  push: 'Fuerza · Empuje',
  pull: 'Fuerza · Tracción',
  legs: 'Fuerza · Piernas',
};

export function splitsOverlap(a: Split, b: Split): boolean {
  const set = new Set(SPLIT_MUSCLES[a]);
  return SPLIT_MUSCLES[b].some((m) => set.has(m));
}

/** Ciclo de splits según la cantidad de días de fuerza en la semana (≥4). */
export function splitCycle(strengthDays: number): Split[] {
  if (strengthDays >= 6) return ['push', 'pull', 'legs', 'push', 'pull', 'legs'];
  if (strengthDays === 5) return ['push', 'pull', 'legs', 'upper', 'lower'];
  return ['upper', 'lower', 'upper', 'lower'];
}

export const WARMUP_IDS = ['marching', 'cat-cow', 'leg-swings', 'worlds-greatest-stretch'];
export const RUN_WARMUP_IDS = ['brisk-walk', 'leg-swings', 'ankle-mobility', 'band-lateral-walk'];
export const COOLDOWN_IDS = ['hamstring-stretch', 'hip-flexor-stretch', 'childs-pose'];
export const RUN_COOLDOWN_IDS = ['calf-stretch', 'quad-stretch', 'hip-flexor-stretch', 'figure-four-stretch'];
export const RECOVERY_MOBILITY_IDS = ['cat-cow', 'thoracic-open-book', 'hip-circles', 'ankle-mobility', 'worlds-greatest-stretch'];
export const RECOVERY_STRETCH_IDS = ['hamstring-stretch', 'figure-four-stretch', 'calf-stretch', 'childs-pose'];
