import type {
  BodyRegion,
  CardioActivity,
  Exercise,
  ISODate,
  PlanInput,
  PlannedDay,
  PlannedExercise,
  PlannedRun,
  RunType,
  SessionType,
} from '../../types/domain.ts';
import { EXERCISES, getExercise, isAvailable } from '../../data/exercises/index.ts';
import { addDays, diffDays, weekday } from '../utils/date.ts';
import {
  COOLDOWN_IDS,
  DELOAD_FACTOR,
  EASY_PACE_SEC,
  GOAL_RX,
  LEVEL_RULES,
  RECOVERY_MOBILITY_IDS,
  RECOVERY_STRETCH_IDS,
  RUN_COOLDOWN_IDS,
  RUN_MAX_GROWTH_FACTOR,
  RUN_WARMUP_IDS,
  RUN_WEEKLY_GROWTH,
  SPLIT_MUSCLES,
  SPLIT_SLOTS,
  SPLIT_TITLES,
  WARMUP_IDS,
  isDeloadWeek,
  setsForWeek,
  splitCycle,
  splitsOverlap,
  type Slot,
  type Split,
} from './rules.ts';

export const PLAN_PRESETS = [7, 14, 20, 30, 60, 90] as const;
export const MAX_PLAN_DAYS = 365;

const WARMUP_MIN = 6;
const COOLDOWN_MIN = 4;

// ─────────────────────────────────────────────────────────────
// Validación
// ─────────────────────────────────────────────────────────────

export function validatePlanInput(input: PlanInput): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(input.duration_days) || input.duration_days < 1 || input.duration_days > MAX_PLAN_DAYS) {
    errors.push(`La duración debe ser un número entero entre 1 y ${MAX_PLAN_DAYS} días.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date)) errors.push('La fecha de inicio no es válida.');
  const wd = new Set(input.training_weekdays);
  if (wd.size === 0) errors.push('Elegí al menos un día de entrenamiento por semana.');
  if ([...wd].some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errors.push('Días de la semana inválidos.');
  if (input.session_minutes < 15 || input.session_minutes > 180) {
    errors.push('El tiempo por sesión debe estar entre 15 y 180 minutos.');
  }
  if (input.running.include && (input.running.max_distance_km < 0 || input.running.max_distance_km > 100)) {
    errors.push('La distancia máxima de carrera no es válida.');
  }
  const acts = input.running.activities;
  if (acts && (acts.some((a) => !CARDIO_ACTIVITIES.includes(a)) || (input.running.include && acts.length === 0))) {
    errors.push('Elegí al menos una actividad de cardio válida (correr, caminar o bici).');
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────
// Paso 1: clasificar días (exigente / recuperación activa / descanso)
// ─────────────────────────────────────────────────────────────

type DayKind = 'hard' | 'recovery' | 'rest';

function classifyDays(input: PlanInput): DayKind[] {
  const rules = LEVEL_RULES[input.level];
  const selected = new Set(input.training_weekdays);
  // Regla: al menos un día completo de descanso por semana.
  if (selected.size === 7) selected.delete(0);

  const kinds: DayKind[] = [];
  const maxConsecutive = input.level === 'beginner' ? 2 : 3;

  for (let weekStart = 0; weekStart < input.duration_days; weekStart += 7) {
    let hardCount = 0;
    for (let i = weekStart; i < Math.min(weekStart + 7, input.duration_days); i++) {
      const date = addDays(input.start_date, i);
      if (!selected.has(weekday(date))) {
        kinds.push('rest');
        continue;
      }
      // Racha de días exigentes inmediatamente anteriores.
      let streak = 0;
      for (let j = kinds.length - 1; j >= 0 && kinds[j] === 'hard'; j--) streak++;
      if (hardCount < rules.max_hard_days && streak < maxConsecutive) {
        kinds.push('hard');
        hardCount++;
      } else {
        kinds.push('recovery');
      }
    }
  }
  return kinds;
}

// ─────────────────────────────────────────────────────────────
// Paso 2: distribuir running vs fuerza dentro de cada semana
// ─────────────────────────────────────────────────────────────

interface Assigned {
  type: SessionType;
  runType?: RunType;
  activity?: CardioActivity;
}

export const CARDIO_ACTIVITIES: readonly CardioActivity[] = ['run', 'walk', 'bike'];

export function cardioActivities(input: PlanInput): CardioActivity[] {
  const a = input.running.activities?.filter((x) => CARDIO_ACTIVITIES.includes(x));
  return a?.length ? [...new Set(a)] : ['run'];
}

/** Cardio para después de la fuerza: el de menor impacto entre los elegidos. */
function finisherActivity(acts: CardioActivity[]): CardioActivity {
  return acts.includes('bike') ? 'bike' : acts.includes('walk') ? 'walk' : 'run';
}

/** Con poco tiempo por sesión, la fuerza va sola (salvo la única sesión de la semana). */
const MIN_COMBO_MINUTES = 40;

function assignSessionTypes(input: PlanInput, kinds: DayKind[]): Assigned[] {
  const out: Assigned[] = kinds.map((k) =>
    k === 'rest' ? { type: 'rest' } : k === 'recovery' ? { type: 'active_recovery' } : { type: 'strength' },
  );
  const share = GOAL_RX[input.goal].run_share;
  const runWalk = isRunWalk(input);
  const acts = cardioActivities(input);
  const fin = finisherActivity(acts);
  const finType: RunType = fin === 'run' && runWalk ? 'run_walk' : 'easy';

  for (let weekStart = 0; weekStart < kinds.length; weekStart += 7) {
    const weekIndex = weekStart / 7;
    const hard: number[] = [];
    for (let i = weekStart; i < Math.min(weekStart + 7, kinds.length); i++) if (kinds[i] === 'hard') hard.push(i);
    const H = hard.length;
    if (H === 0 || !input.running.include) continue;

    if (H === 1) {
      if (input.session_minutes >= MIN_COMBO_MINUTES) out[hard[0]!] = { type: 'strength_run', runType: finType, activity: fin };
      // Sesiones cortas: no entran las dos cosas; se alterna una semana fuerza y otra cardio.
      else if (weekIndex % 2 === 1) out[hard[0]!] = { type: 'run', runType: finType, activity: acts[Math.floor(weekIndex / 2) % acts.length]! };
      continue;
    }

    const R = Math.min(H - 1, Math.max(1, Math.round(H * share)));
    const S = H - R;
    // Repartir los días de fuerza de forma pareja para que no queden juntos.
    const strengthPos = new Set<number>();
    for (let i = 0; i < S; i++) strengthPos.add(Math.round(((i + 0.5) * H) / S - 0.5));
    const runIdx = hard.filter((_, pos) => !strengthPos.has(pos));

    // Fuerza + cardio: cada día de fuerza termina con un bloque de cardio suave.
    if (input.session_minutes >= MIN_COMBO_MINUTES) {
      hard.forEach((dayIdx, pos) => {
        if (strengthPos.has(pos)) out[dayIdx] = { type: 'strength_run', runType: finType, activity: fin };
      });
    }

    const deload = isDeloadWeek(weekIndex);
    const qualityAllowed = !deload && (input.level !== 'beginner' || weekIndex >= 2) && runIdx.length >= 2;
    runIdx.forEach((dayIdx, n) => {
      // Las actividades rotan entre semanas para que todas aparezcan.
      const activity = acts[(weekIndex + n) % acts.length]!;
      const isLast = n === runIdx.length - 1 && runIdx.length >= 2;
      let runType: RunType;
      if (activity === 'run' && runWalk) runType = 'run_walk';
      else if (isLast) runType = 'long';
      else if (n === 0 && qualityAllowed && !(activity === 'run' && runWalk)) runType = activity === 'walk' ? 'tempo' : weekIndex % 2 === 0 ? 'intervals' : 'tempo';
      else runType = 'easy';
      out[dayIdx] = { type: 'run', runType, activity };
    });
  }
  return out;
}

function isRunWalk(input: PlanInput): boolean {
  return input.running.experience === 'none' || input.running.max_distance_km < 2;
}

// ─────────────────────────────────────────────────────────────
// Paso 3: asignar splits respetando la recuperación muscular
// ─────────────────────────────────────────────────────────────

function assignSplits(assigned: Assigned[]): Map<number, { split: Split; variant: number }> {
  const result = new Map<number, { split: Split; variant: number }>();
  const strengthIdx = assigned.map((a, i) => (a.type === 'strength' || a.type === 'strength_run' ? i : -1)).filter((i) => i >= 0);

  let prev: { idx: number; split: Split } | null = null;
  let lastUL: Split | null = null;
  const fullCountPerWeek = new Map<number, number>();
  const cyclePosPerWeek = new Map<number, number>();

  for (let k = 0; k < strengthIdx.length; k++) {
    const idx = strengthIdx[k]!;
    const week = Math.floor(idx / 7);
    const S = strengthIdx.filter((i) => Math.floor(i / 7) === week).length;
    const adjPrev: boolean = prev !== null && idx - prev.idx === 1;
    const next = strengthIdx[k + 1];
    const adjNext = next !== undefined && next - idx === 1;

    let split: Split;
    // Los días de fuerza + cardio se reparten igual que los de fuerza sola.
    if (S >= 4) {
      const cycle = splitCycle(S);
      const pos = cyclePosPerWeek.get(week) ?? 0;
      split = cycle[pos % cycle.length]!;
      cyclePosPerWeek.set(week, pos + 1);
      if (adjPrev && prev && prev.split === split) {
        split = (['upper', 'lower', 'push', 'pull', 'legs'] as Split[]).find((s) => !splitsOverlap(prev!.split, s)) ?? split;
      }
    } else if (!adjPrev && !adjNext) {
      split = 'full';
    } else if (adjPrev && prev) {
      split = prev.split === 'upper' ? 'lower' : prev.split === 'lower' ? 'upper' : prev.split === 'full' ? 'upper' : 'upper';
    } else {
      split = lastUL === 'upper' ? 'lower' : 'upper';
    }

    if (split === 'upper' || split === 'lower') lastUL = split;
    const fullN = fullCountPerWeek.get(week) ?? 0;
    if (split === 'full') fullCountPerWeek.set(week, fullN + 1);
    // Variante: cambia cada mesociclo (estable 4 semanas = sobrecarga progresiva) y entre A/B/C.
    const variant = Math.floor(week / 4) + (split === 'full' ? fullN : 0);
    result.set(idx, { split, variant });
    prev = { idx, split };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// Selección de ejercicios
// ─────────────────────────────────────────────────────────────

interface SelectCtx {
  input: PlanInput;
  library: readonly Exercise[];
  used: Set<string>;
}

function candidatesFor(slot: Slot, ctx: SelectCtx, maxDifficulty: number): Exercise[] {
  const { input } = ctx;
  const rules = LEVEL_RULES[input.level];
  const injuries = new Set<BodyRegion>(input.injuries);
  return ctx.library
    .filter(
      (e) =>
        slot.patterns.includes(e.pattern) &&
        (!slot.muscle || e.primary_muscle === slot.muscle) &&
        (e.type === 'strength' || e.type === 'core' || (e.type === 'plyometric' && rules.allow_plyometrics)) &&
        e.difficulty <= maxDifficulty &&
        isAvailable(e, input.equipment) &&
        !e.stress_regions.some((r) => injuries.has(r)) &&
        !ctx.used.has(e.id),
    )
    .sort((a, b) => {
      // Preferir la dificultad más alta permitida y, si hay equipamiento, ejercicios con carga.
      if (b.difficulty !== a.difficulty) return b.difficulty - a.difficulty;
      const la = a.equipment.includes('bodyweight') ? 0 : 1;
      const lb = b.equipment.includes('bodyweight') ? 0 : 1;
      const owned = input.equipment.some((eq) => eq !== 'bodyweight');
      if (owned && la !== lb) return lb - la;
      return a.id.localeCompare(b.id);
    });
}

function pickForSlot(slot: Slot, ctx: SelectCtx, variant: number): { ex: Exercise; harder: boolean } | null {
  const max = LEVEL_RULES[ctx.input.level].max_difficulty;
  let list = candidatesFor(slot, ctx, max);
  let harder = false;
  if (list.length === 0 && max < 3) {
    // Sin opciones a este nivel (p. ej. tracción sin equipamiento): una variante más exigente y escalable.
    list = candidatesFor(slot, ctx, max + 1);
    harder = list.length > 0;
  }
  const ex = list[variant % Math.max(1, list.length)];
  return ex ? { ex, harder } : null;
}

function repsFor(ex: Exercise, input: PlanInput): string {
  if (ex.timed) {
    const t = input.level === 'beginner' ? '20-30 s' : input.level === 'intermediate' ? '30-45 s' : '45-60 s';
    return ex.unilateral ? `${t} por lado` : t;
  }
  const base = ex.type === 'core' ? '10-15' : GOAL_RX[input.goal].reps;
  return ex.unilateral ? `${base} por lado` : base;
}

function restFor(ex: Exercise, input: PlanInput): number {
  if (ex.type === 'core') return 45;
  const base = GOAL_RX[input.goal].rest_seconds;
  return ex.difficulty === 3 && input.level === 'advanced' ? base + 30 : base;
}

/** Minutos estimados de un ejercicio: trabajo + descansos + transición. */
export function exerciseMinutes(pe: PlannedExercise): number {
  const ex = getExercise(pe.exercise_id);
  const work = (ex?.timed ? 40 : 40) * (ex?.unilateral ? 1.8 : 1);
  return (pe.sets * (work + pe.rest_seconds)) / 60 + 1;
}

function buildStrength(
  split: Split,
  variant: number,
  input: PlanInput,
  weekIndex: number,
  budgetMin: number,
  library: readonly Exercise[],
): { exercises: PlannedExercise[]; notes: string[] } {
  const ctx: SelectCtx = { input, library, used: new Set() };
  const deload = isDeloadWeek(weekIndex);
  const rx = GOAL_RX[input.goal];
  let rpe = deload ? rx.rpe - 2 : rx.rpe;
  if (input.level === 'beginner') rpe = Math.min(rpe, 7);
  const sets = setsForWeek(input.level, weekIndex);

  const base = SPLIT_SLOTS[split];
  const required = base.filter((s) => !s.optional);
  const optional = base.filter((s) => s.optional);
  // Grupos que el usuario quiere priorizar y que este split cubre (abdomen en cualquier día).
  const splitMuscles = new Set(SPLIT_MUSCLES[split]);
  const focusSlots: Slot[] = input.focus_muscles
    .filter((m) => splitMuscles.has(m) || m === 'abs')
    .map((m) => ({ patterns: patternsForMuscle(m), muscle: m, optional: true }));

  const exercises: PlannedExercise[] = [];
  const notes: string[] = [];
  let used = 0;

  const add = (slot: Slot, mandatory: boolean) => {
    const picked = pickForSlot(slot, ctx, variant);
    if (!picked) return;
    const pe: PlannedExercise = {
      exercise_id: picked.ex.id,
      sets,
      reps: repsFor(picked.ex, input),
      rest_seconds: restFor(picked.ex, input),
      rpe,
      ...(picked.harder ? { notes: 'Variante algo más exigente: usá la versión fácil si no completás las repeticiones con buena técnica.' } : {}),
    };
    const mins = exerciseMinutes(pe);
    if (!mandatory && used + mins > budgetMin) return;
    ctx.used.add(picked.ex.id);
    exercises.push(pe);
    used += mins;
  };

  required.forEach((s) => add(s, true));
  focusSlots.forEach((s) => add(s, false));
  optional.forEach((s) => add(s, false));

  // Si lo obligatorio no entra en el tiempo, recortar series (mínimo 2, o 1 en descarga).
  const minSets = deload ? 1 : 2;
  while (used > budgetMin && exercises.some((e) => e.sets > minSets)) {
    const target = exercises.reduce((a, b) => (b.sets > a.sets ? b : a));
    target.sets -= 1;
    used = exercises.reduce((acc, e) => acc + exerciseMinutes(e), 0);
  }
  if (used > budgetMin) notes.push('La sesión supera levemente el tiempo disponible: priorizá los primeros ejercicios.');
  return { exercises, notes };
}

function patternsForMuscle(m: Exercise['primary_muscle']): Slot['patterns'] {
  switch (m) {
    case 'chest': return ['horizontal_push'];
    case 'back': return ['horizontal_pull', 'vertical_pull'];
    case 'shoulders': return ['vertical_push', 'shoulder_raise'];
    case 'biceps': return ['elbow_flexion'];
    case 'triceps': return ['elbow_extension'];
    case 'abs': return ['core_anti_extension', 'core_flexion', 'core_rotation'];
    case 'quads': return ['squat', 'lunge'];
    case 'hamstrings': return ['hinge'];
    case 'glutes': return ['hinge', 'hip_abduction', 'lunge'];
    case 'calves': return ['calf'];
    default: return ['conditioning'];
  }
}

// ─────────────────────────────────────────────────────────────
// Running
// ─────────────────────────────────────────────────────────────

/** Semanas de carga completadas antes de esta (las descargas no suman progresión). */
function progressionWeeks(weekIndex: number): number {
  return weekIndex - Math.floor(weekIndex / 4);
}

export function runVolumeFactor(weekIndex: number): number {
  if (isDeloadWeek(weekIndex)) return runVolumeFactor(weekIndex - 1) * DELOAD_FACTOR;
  return Math.min(RUN_MAX_GROWTH_FACTOR, (1 + RUN_WEEKLY_GROWTH) ** progressionWeeks(weekIndex));
}

const round05 = (n: number) => Math.round(n * 2) / 2;
const floor01 = (n: number) => Math.floor(n * 10 + 1e-9) / 10;

/**
 * Distancia para una semana a partir de una base, garantizando que ninguna semana de carga
 * supere en más de 10% a la semana de carga anterior (incluido el efecto del redondeo).
 */
export function progressiveDistance(base: number, weekIndex: number): number {
  let lastLoad = floor01(base);
  let current = lastLoad;
  for (let w = 1; w <= weekIndex; w++) {
    if (isDeloadWeek(w)) {
      current = floor01(lastLoad * DELOAD_FACTOR);
    } else {
      current = Math.min(floor01(base * runVolumeFactor(w)), floor01(lastLoad * 1.1));
      current = Math.max(current, lastLoad); // nunca retroceder entre semanas de carga
      lastLoad = current;
    }
  }
  return current;
}

/** Sesión de cardio de la actividad indicada (running, caminata o bici). */
export function buildCardio(type: RunType, activity: CardioActivity, input: PlanInput, weekIndex: number, capMin: number): PlannedRun {
  if (activity === 'walk') return buildWalk(type, input, weekIndex, capMin);
  if (activity === 'bike') return buildBike(type, input, weekIndex, capMin);
  return { ...buildRun(type, input, weekIndex, capMin), activity: 'run' };
}

/** Ritmo de caminata enérgica (seg/km) y velocidad cómoda en bici (km/h) según el nivel. */
const WALK_PACE_SEC = { beginner: 660, intermediate: 600, advanced: 570 } as const;
const BIKE_SPEED_KMH = { beginner: 16, intermediate: 20, advanced: 24 } as const;
const WALK_BASE_MIN = { beginner: 25, intermediate: 30, advanced: 35 } as const;
const BIKE_BASE_MIN = { beginner: 30, intermediate: 40, advanced: 50 } as const;

/** Minutos de una sesión que progresa (máx. +10% semanal, descarga cada 4 semanas). */
function progressiveMinutes(base: number, type: RunType, weekIndex: number, capMin: number): number {
  const start = type === 'long' ? base * 1.5 : type === 'easy' ? base : base * 0.9;
  const max = type === 'long' ? capMin * 1.5 : capMin - 8;
  return Math.max(10, Math.round(Math.min(progressiveDistance(start, weekIndex), max)));
}

function buildWalk(type: RunType, input: PlanInput, weekIndex: number, capMin: number): PlannedRun {
  const t: RunType = type === 'long' ? 'long' : type === 'easy' || type === 'run_walk' ? 'easy' : 'tempo';
  const pace = WALK_PACE_SEC[input.level];
  const minutes = progressiveMinutes(WALK_BASE_MIN[input.level], t, weekIndex, capMin);
  const fast = Math.max(2, Math.min(5, 2 + Math.floor(progressionWeeks(weekIndex) / 2)));
  const blocks = Math.max(3, Math.floor((minutes - 10) / (fast + 2)));
  const instructions: Record<'easy' | 'tempo' | 'long', string[]> = {
    easy: ['Caminata enérgica continua: paso largo, brazos activos, respiración agitada pero podés hablar.', 'Elegí un recorrido llano o con pendientes suaves.'],
    tempo: ['5 minutos a paso normal para entrar en calor.', `${blocks} bloques de ${fast} min a paso muy rápido + 2 min a paso normal.`, 'Terminá con 5 minutos a paso tranquilo.'],
    long: ['Caminata larga a ritmo cómodo y constante.', 'Llevá agua y calzado cómodo; si hay subidas, mejor.'],
  };
  return {
    type: t,
    activity: 'walk',
    duration_min: minutes,
    distance_km: Math.max(1, floor01((minutes * 60) / pace)),
    intensity: t === 'tempo' ? 'Moderada con picos (RPE 6–7 en los bloques rápidos).' : 'Moderada (RPE 4–5): respiración agitada, pero podés conversar.',
    instructions: instructions[t as 'easy' | 'tempo' | 'long'],
  };
}

function buildBike(type: RunType, input: PlanInput, weekIndex: number, capMin: number): PlannedRun {
  const t: RunType = type === 'run_walk' ? 'easy' : type;
  const speed = BIKE_SPEED_KMH[input.level];
  const minutes = progressiveMinutes(BIKE_BASE_MIN[input.level], t, weekIndex, capMin);
  const reps = Math.min(8, 4 + Math.floor(progressionWeeks(weekIndex) / 2));
  const instructions: Record<'easy' | 'tempo' | 'intervals' | 'long', string[]> = {
    easy: ['Pedaleo suave y continuo, con cambios livianos (piernas ágiles, sin forzar).', 'Siempre con casco; de noche, luces delantera y trasera.'],
    tempo: ['10 minutos suaves para entrar en calor.', `${Math.min(30, 12 + progressionWeeks(weekIndex) * 2)} minutos a ritmo "cómodamente exigente" sostenido.`, 'Terminá con pedaleo suave.', 'Siempre con casco.'],
    intervals: ['10 minutos suaves para entrar en calor.', `${reps} × 2 minutos fuerte (RPE 8) con 2 minutos suaves entre cada uno.`, 'Terminá con pedaleo suave. Hacé los bloques fuertes donde no haya tránsito.', 'Siempre con casco.'],
    long: ['Salida larga a ritmo cómodo y constante.', 'Llevá agua y algo para comer si dura más de 75 minutos.', 'Siempre con casco; revisá frenos y cubiertas antes de salir.'],
  };
  return {
    type: t,
    activity: 'bike',
    duration_min: minutes,
    distance_km: Math.max(1, floor01((minutes / 60) * speed * (t === 'easy' || t === 'long' ? 1 : 0.95))),
    intensity:
      t === 'intervals' ? 'Alta en los bloques (RPE 8), muy suave en las pausas.'
        : t === 'tempo' ? 'Moderada-alta sostenida (RPE 7).'
          : 'Suave (RPE 4–5): podés mantener una conversación.',
    instructions: instructions[t as 'easy' | 'tempo' | 'intervals' | 'long'],
  };
}

const CARDIO_TITLES: Record<CardioActivity, Partial<Record<RunType, string>>> = {
  run: {},
  walk: { easy: 'Caminata · Ritmo enérgico', tempo: 'Caminata · Cambios de ritmo', long: 'Caminata · Larga' },
  bike: { easy: 'Bici · Suave', tempo: 'Bici · Ritmo sostenido', intervals: 'Bici · Intervalos', long: 'Bici · Salida larga' },
};

export function cardioTitle(run: PlannedRun): string {
  const a = run.activity ?? 'run';
  return CARDIO_TITLES[a][run.type] ?? RUN_TITLES[run.type];
}

const COMBO_SUFFIX: Record<CardioActivity, string> = { run: 'trote', walk: 'caminata', bike: 'bici' };

export function buildRun(type: RunType, input: PlanInput, weekIndex: number, capMin: number): PlannedRun {
  const pace = EASY_PACE_SEC[input.running.experience];
  const deload = isDeloadWeek(weekIndex);

  if (type === 'run_walk') {
    const k = deload ? Math.max(0, progressionWeeks(weekIndex) - 1) : progressionWeeks(weekIndex);
    const jogSec = Math.min(60 + 30 * k, 600);
    const walkSec = Math.max(60, 120 - 15 * k);
    const total = Math.min(capMin, 20 + 2 * Math.min(k, 8));
    const blocks = Math.max(3, Math.floor(((total - 10) * 60) / (jogSec + walkSec)));
    const jogKm = (blocks * jogSec) / pace;
    const walkKm = (blocks * walkSec + 600) / (11 * 60);
    return {
      type,
      distance_km: Math.round((jogKm + walkKm) * 10) / 10,
      duration_min: Math.round((blocks * (jogSec + walkSec)) / 60 + 10),
      intensity: 'Suave: tenés que poder hablar mientras trotás (RPE 4–5).',
      instructions: [
        '5 minutos de caminata enérgica para entrar en calor.',
        `${blocks} bloques de ${fmtSec(jogSec)} trotando suave + ${fmtSec(walkSec)} caminando.`,
        '5 minutos de caminata para volver a la calma.',
        'Si no podés completar un bloque, caminá más tiempo: el objetivo es terminar sin agotarte.',
      ],
    };
  }

  // El fondo arranca en ~80% de lo que la persona puede correr hoy; los trotes en ~60% del fondo.
  const capacity = Math.min(30, input.running.max_distance_km);
  const long0 = Math.max(1.5, capacity * 0.8);
  const easy0 = Math.max(1.5, long0 * 0.6);

  const maxMin = type === 'long' ? capMin * 1.5 : capMin - 10;
  const maxDist = floor01((maxMin * 60) / pace);
  const planned = progressiveDistance(type === 'long' ? long0 : easy0, weekIndex);
  const distance = Math.max(1, Math.min(planned, maxDist));
  const duration = Math.round((distance * pace) / 60) + (type === 'easy' ? 0 : 10);

  const instructions: Record<Exclude<RunType, 'run_walk'>, string[]> = {
    easy: [
      'Trote suave continuo a ritmo conversacional.',
      'Si el pulso o la respiración se disparan, bajá el ritmo o caminá 1 minuto.',
    ],
    long: [
      'Carrera larga a ritmo cómodo y constante (el más lento de la semana).',
      'Llevá agua si dura más de 60 minutos.',
      'Está bien caminar breves tramos: lo importante es el tiempo en movimiento.',
    ],
    tempo: [
      '10 minutos de trote suave.',
      `${Math.min(25, 12 + progressionWeeks(weekIndex))} minutos a ritmo "cómodamente exigente" (podés decir frases cortas).`,
      'Completá la distancia con trote suave.',
    ],
    intervals: [
      '10 minutos de trote suave + 4 aceleraciones progresivas de 20 s.',
      `${Math.min(8, 4 + Math.floor(progressionWeeks(weekIndex) / 2))} × 2 minutos a ritmo fuerte (RPE 8) con 2 minutos de trote muy suave entre cada uno.`,
      'Completá la distancia con trote suave.',
    ],
  };

  return {
    type,
    distance_km: distance,
    duration_min: duration,
    intensity:
      type === 'intervals' ? 'Alta en los bloques (RPE 8), muy suave en las pausas.'
        : type === 'tempo' ? 'Moderada-alta sostenida (RPE 7).'
          : 'Suave (RPE 4–5): podés mantener una conversación.',
    instructions: instructions[type],
  };
}

function fmtSec(s: number): string {
  if (s % 60 === 0) return `${s / 60} min`;
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

const RUN_TITLES: Record<RunType, string> = {
  run_walk: 'Running · Trote y caminata',
  easy: 'Running · Trote suave',
  tempo: 'Running · Tempo',
  intervals: 'Running · Intervalos',
  long: 'Running · Fondo largo',
};

// ─────────────────────────────────────────────────────────────
// Recuperación activa y descanso
// ─────────────────────────────────────────────────────────────

function buildRecovery(input: PlanInput, dayIndex: number, library: readonly Exercise[]): PlannedExercise[] {
  const injuries = new Set(input.injuries);
  const ok = (id: string) => {
    const e = library.find((x) => x.id === id);
    return !!e && isAvailable(e, input.equipment) && !e.stress_regions.some((r) => injuries.has(r));
  };
  const rot = <T,>(arr: T[], n: number, k: number) => Array.from({ length: Math.min(k, arr.length) }, (_, i) => arr[(n + i) % arr.length]!);

  const cardioId = ok('brisk-walk') ? 'brisk-walk' : ok('stationary-bike') ? 'stationary-bike' : null;
  const out: PlannedExercise[] = [];
  if (cardioId) out.push({ exercise_id: cardioId, sets: 1, reps: `${Math.min(30, Math.max(15, input.session_minutes - 15))} min`, rest_seconds: 0, rpe: 3 });
  rot(RECOVERY_MOBILITY_IDS.filter(ok), dayIndex, 3).forEach((id) =>
    out.push({ exercise_id: id, sets: 1, reps: '8-10 repeticiones lentas', rest_seconds: 15, rpe: 2 }),
  );
  rot(RECOVERY_STRETCH_IDS.filter(ok), dayIndex, 2).forEach((id) =>
    out.push({ exercise_id: id, sets: 1, reps: '30 s por lado', rest_seconds: 0, rpe: 2 }),
  );
  return out;
}

function names(ids: string[]): string {
  return ids.map((id) => getExercise(id)?.name).filter(Boolean).join(', ');
}

// ─────────────────────────────────────────────────────────────
// API principal
// ─────────────────────────────────────────────────────────────

export function generatePlan(input: PlanInput, library: readonly Exercise[] = EXERCISES): PlannedDay[] {
  const errors = validatePlanInput(input);
  if (errors.length) throw new PlanValidationError(errors);

  const kinds = classifyDays(input);
  const assigned = assignSessionTypes(input, kinds);
  const splits = assignSplits(assigned);
  const strengthBudget = input.session_minutes - WARMUP_MIN - COOLDOWN_MIN;

  return assigned.map((a, i): PlannedDay => {
    const date = addDays(input.start_date, i);
    const weekIndex = Math.floor(i / 7);
    const deload = isDeloadWeek(weekIndex);
    const base = { day_number: i + 1, date, week_index: weekIndex, is_deload: deload };
    const deloadNote = deload ? ['Semana de descarga: menos volumen para recuperarte y consolidar lo entrenado.'] : [];

    switch (a.type) {
      case 'rest':
        return {
          ...base, session_type: 'rest', title: 'Descanso', focus: [], estimated_minutes: 0, intensity: 'Descanso',
          exercises: [], run: null,
          instructions: ['Descanso completo. Dormí bien, hidratate y, si querés, salí a caminar tranquilo.'],
        };
      case 'active_recovery': {
        const exercises = buildRecovery(input, i, library);
        return {
          ...base, session_type: 'active_recovery', title: 'Recuperación activa', focus: ['mobility', 'stretching'],
          estimated_minutes: Math.min(input.session_minutes, 35), intensity: 'Muy suave (RPE 2–3)', exercises, run: null,
          instructions: ['Movimiento suave para favorecer la recuperación. No debería cansarte.', ...deloadNote],
        };
      }
      case 'run': {
        const run = buildCardio(a.runType!, a.activity ?? 'run', input, weekIndex, input.session_minutes);
        return {
          ...base, session_type: 'run', title: cardioTitle(run), focus: run.activity === 'bike' ? ['cardio', 'quads'] : ['cardio', 'calves'],
          estimated_minutes: run.duration_min + 8, intensity: run.intensity, exercises: [], run,
          instructions: [
            `Entrada en calor: ${names(RUN_WARMUP_IDS)}.`,
            ...run.instructions,
            `Al terminar: ${names(RUN_COOLDOWN_IDS)}.`,
            ...deloadNote,
          ],
        };
      }
      case 'strength':
      case 'strength_run': {
        const s = splits.get(i)!;
        const isCombo = a.type === 'strength_run';
        const comboAct = a.activity ?? 'run';
        // El bloque de cardio ocupa ~1/3 de la sesión (10–20 min); el resto es fuerza.
        const comboCap = Math.min(28, Math.max(18, Math.round(input.session_minutes * 0.35) + 8));
        const run = isCombo ? buildCardio(a.runType ?? 'easy', comboAct, input, weekIndex, comboCap) : null;
        const budget = isCombo ? Math.max(12, strengthBudget - (run?.duration_min ?? 0)) : strengthBudget;
        const { exercises, notes } = buildStrength(s.split, s.variant, input, weekIndex, budget, library);
        const strengthMin = Math.round(exercises.reduce((acc, e) => acc + exerciseMinutes(e), 0));
        const focus = [...new Set(exercises.map((e) => getExercise(e.exercise_id)!.primary_muscle))];
        return {
          ...base,
          session_type: a.type,
          title: isCombo ? `${SPLIT_TITLES[s.split]} + ${COMBO_SUFFIX[comboAct]}` : SPLIT_TITLES[s.split],
          focus,
          estimated_minutes: strengthMin + WARMUP_MIN + COOLDOWN_MIN + (run?.duration_min ?? 0),
          intensity: `Moderada · RPE ${exercises[0]?.rpe ?? 7}: terminá cada serie con 2–3 repeticiones en reserva.`,
          exercises,
          run,
          instructions: [
            `Entrada en calor (${WARMUP_MIN} min): ${names(WARMUP_IDS)}.`,
            'Progresión: cuando completes todas las series en el tope del rango con buena técnica, sumá carga o 1–2 repeticiones la próxima vez.',
            'Si aparece dolor articular (distinto del esfuerzo muscular), detené el ejercicio.',
            ...(isCombo && run ? [`Hacé primero la fuerza y después ${run.duration_min} min de ${comboAct === 'run' ? 'trote suave' : comboAct === 'walk' ? 'caminata enérgica' : 'bici suave'}.`] : []),
            `Vuelta a la calma: ${names(COOLDOWN_IDS)}.`,
            ...notes,
            ...deloadNote,
          ],
        };
      }
    }
  });
}

export class PlanValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'PlanValidationError';
  }
}

// ─────────────────────────────────────────────────────────────
// Ajustes: fatiga, dolor, reprogramación, cambios de ejercicio
// ─────────────────────────────────────────────────────────────

export interface ReadinessReport {
  fatigue: 1 | 2 | 3 | 4 | 5; // 1 = descansado … 5 = agotado
  pain_regions: BodyRegion[];
}

export interface AdjustmentResult {
  day: PlannedDay;
  changes: string[];
  warnings: string[];
  recommend_professional: boolean;
}

/**
 * Adapta la sesión del día al estado reportado. Nunca agrega volumen: solo reduce, reemplaza o suspende.
 */
export function adjustForReadiness(
  day: PlannedDay,
  report: ReadinessReport,
  input: Pick<PlanInput, 'equipment' | 'level' | 'injuries'>,
  library: readonly Exercise[] = EXERCISES,
): AdjustmentResult {
  const changes: string[] = [];
  const warnings: string[] = [];
  const pain = new Set(report.pain_regions);
  let out: PlannedDay = clone(day);
  const recommendProfessional = pain.size > 0;

  if (pain.size > 0) {
    warnings.push(
      'Reportaste dolor. Evitá los movimientos que lo provocan. Si es intenso, aparece en reposo o persiste más de unos días, consultá a un médico o kinesiólogo antes de seguir entrenando esa zona.',
    );
    const blocked = new Set<BodyRegion>([...input.injuries, ...pain]);
    out.exercises = out.exercises.flatMap((pe) => {
      const ex = library.find((e) => e.id === pe.exercise_id);
      if (!ex || !ex.stress_regions.some((r) => pain.has(r))) return [pe];
      const alt = library.find(
        (e) => e.pattern === ex.pattern && e.id !== ex.id && e.type === ex.type && isAvailable(e, input.equipment) &&
          !e.stress_regions.some((r) => blocked.has(r)) && !out.exercises.some((o) => o.exercise_id === e.id),
      );
      if (alt) {
        changes.push(`${ex.name} → ${alt.name} (evita cargar la zona con dolor).`);
        return [{ ...pe, exercise_id: alt.id }];
      }
      changes.push(`Se quitó ${ex.name}: no hay una alternativa segura para la zona con dolor.`);
      return [];
    });
    const act = out.run?.activity ?? 'run';
    const loaded: BodyRegion[] = act === 'walk' ? ['knee', 'ankle'] : act === 'bike' ? ['knee', 'hip', 'lower_back'] : ['knee', 'ankle', 'hip', 'lower_back'];
    if (out.run && loaded.some((r) => pain.has(r))) {
      changes.push(act === 'run' ? 'Se suspende la carrera de hoy por dolor en una zona de impacto.' : `Se suspende ${act === 'walk' ? 'la caminata' : 'la bici'} de hoy por dolor en una zona que carga.`);
      out.run = null;
      if (out.session_type === 'run') {
        out = toRecovery(out, 'Carrera suspendida por dolor: recuperación muy suave sin impacto.');
      } else if (out.session_type === 'strength_run') {
        out.session_type = 'strength';
      }
    }
  }

  if (report.fatigue === 5 && out.session_type !== 'rest') {
    changes.push('Fatiga muy alta: la sesión se convierte en recuperación activa.');
    out = toRecovery(out, 'Hoy toca recuperar. Si la fatiga se repite varios días, revisá sueño, alimentación y estrés.');
    out.exercises = out.exercises.length ? out.exercises : [{ exercise_id: 'brisk-walk', sets: 1, reps: '15-20 min', rest_seconds: 0, rpe: 2 }];
  } else if (report.fatigue === 4) {
    if (out.exercises.length && out.session_type !== 'active_recovery') {
      out.exercises = out.exercises.map((e) => ({ ...e, sets: Math.max(1, Math.round(e.sets * 0.6)), rpe: Math.max(5, e.rpe - 2) }));
      changes.push('Fatiga alta: ~40% menos series y menor intensidad.');
    }
    if (out.run) {
      out.run = {
        ...out.run,
        type: out.run.type === 'run_walk' ? 'run_walk' : 'easy',
        distance_km: Math.max(1, round05(out.run.distance_km * 0.7)),
        duration_min: Math.round(out.run.duration_min * 0.7),
        intensity: 'Suave (RPE 4): sin bloques intensos hoy.',
      };
      changes.push(`${(out.run.activity ?? 'run') === 'run' ? 'Carrera acortada' : 'Cardio acortado'} 30% y sin intensidad.`);
    }
  }

  out.estimated_minutes = estimateDayMinutes(out);
  return { day: out, changes, warnings, recommend_professional: recommendProfessional };
}

function toRecovery(day: PlannedDay, note: string): PlannedDay {
  return {
    ...day,
    session_type: 'active_recovery',
    title: 'Recuperación activa',
    run: null,
    intensity: 'Muy suave (RPE 2–3)',
    exercises: day.exercises.filter((e) => {
      const ex = getExercise(e.exercise_id);
      return ex && (ex.type === 'mobility' || ex.type === 'stretch' || ex.id === 'brisk-walk');
    }),
    instructions: [note],
  };
}

export function estimateDayMinutes(day: PlannedDay): number {
  if (day.session_type === 'rest') return 0;
  if (day.session_type === 'active_recovery') return Math.max(15, Math.round(day.exercises.reduce((a, e) => a + exerciseMinutes(e), 0)));
  const s = day.exercises.reduce((a, e) => a + exerciseMinutes(e), 0);
  return Math.round(s + (day.exercises.length ? WARMUP_MIN + COOLDOWN_MIN : 0) + (day.run ? day.run.duration_min + (day.session_type === 'run' ? 8 : 0) : 0));
}

export type FatigueSignal = 'none' | 'reduce' | 'deload';

/**
 * Detecta fatiga acumulada a partir de las últimas sesiones completadas
 * (esfuerzo percibido 1–10 y reportes de fatiga 1–5).
 */
export function detectFatigue(recent: { rpe: number | null; fatigue: number | null }[]): FatigueSignal {
  const last = recent.slice(-5);
  const highRpe = last.filter((s) => (s.rpe ?? 0) >= 9).length;
  const highFatigue = last.filter((s) => (s.fatigue ?? 0) >= 4).length;
  if (highFatigue >= 3 || highRpe >= 3) return 'deload';
  if (highFatigue >= 2 || highRpe >= 2) return 'reduce';
  return 'none';
}

/** Aplica una descarga (−40% volumen) a los días pendientes desde `from` durante 7 días. */
export function applyDeload(days: PlannedDay[], from: ISODate): PlannedDay[] {
  return days.map((d) => {
    const dd = diffDays(from, d.date);
    if (dd < 0 || dd >= 7 || d.session_type === 'rest') return d;
    const out = clone(d);
    out.is_deload = true;
    out.exercises = out.exercises.map((e) => ({ ...e, sets: Math.max(1, Math.round(e.sets * 0.6)), rpe: Math.max(5, e.rpe - 2) }));
    if (out.run) out.run = { ...out.run, type: out.run.type === 'run_walk' ? 'run_walk' : 'easy', distance_km: Math.max(1, round05(out.run.distance_km * 0.7)), duration_min: Math.round(out.run.duration_min * 0.7) };
    out.estimated_minutes = estimateDayMinutes(out);
    return out;
  });
}

/**
 * Reprograma una sesión a otra fecha del plan. Solo se puede mover a un día de descanso
 * (intercambio): nunca se duplican sesiones ni se apilan dos entrenamientos el mismo día.
 */
export function rescheduleDay(days: PlannedDay[], fromDate: ISODate, toDate: ISODate): PlannedDay[] {
  const from = days.find((d) => d.date === fromDate);
  const to = days.find((d) => d.date === toDate);
  if (!from || !to) throw new Error('La fecha está fuera del plan.');
  if (from.session_type === 'rest') throw new Error('No hay una sesión para mover ese día.');
  if (to.session_type !== 'rest') throw new Error('Solo podés mover una sesión a un día de descanso.');
  return days.map((d) => {
    if (d.date === fromDate) return { ...to, date: fromDate, day_number: d.day_number, week_index: d.week_index };
    if (d.date === toDate) return { ...from, date: toDate, day_number: d.day_number, week_index: d.week_index };
    return d;
  });
}

/** Alternativas para cambiar un ejercicio: mismo patrón, equipamiento disponible y sin zonas lesionadas. */
export function alternativesFor(
  exerciseId: string,
  input: Pick<PlanInput, 'equipment' | 'injuries'>,
  library: readonly Exercise[] = EXERCISES,
): Exercise[] {
  const ex = library.find((e) => e.id === exerciseId);
  if (!ex) return [];
  const inj = new Set(input.injuries);
  return library
    .filter((e) => e.id !== ex.id && e.pattern === ex.pattern && isAvailable(e, input.equipment) && !e.stress_regions.some((r) => inj.has(r)))
    .sort((a, b) => Math.abs(a.difficulty - ex.difficulty) - Math.abs(b.difficulty - ex.difficulty) || a.name.localeCompare(b.name));
}

export function swapExercise(day: PlannedDay, index: number, newExerciseId: string): PlannedDay {
  if (!getExercise(newExerciseId)) throw new Error('Ejercicio inexistente.');
  if (index < 0 || index >= day.exercises.length) throw new Error('Índice de ejercicio inválido.');
  const out = clone(day);
  const target = out.exercises[index]!;
  const ex = getExercise(newExerciseId)!;
  out.exercises[index] = { ...target, exercise_id: newExerciseId, reps: ex.timed ? '30-45 s' : target.reps };
  out.estimated_minutes = estimateDayMinutes(out);
  return out;
}

/** Copia profunda de datos planos (los días del plan son JSON puro). */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
