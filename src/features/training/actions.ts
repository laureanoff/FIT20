import { adjustForReadiness, generatePlan, rescheduleDay, swapExercise, type ReadinessReport } from '@/core/planning/engine';
import { addDays } from '@/core/utils/date';
import { getExercise } from '@/data/exercises';
import { type ExerciseSet, type Fit20DB, type L, type TrainingDay, type TrainingPlan, type Workout, type WorkoutExercise, alive } from '@/lib/db/database';
import { type PendingWrite, saveRecords } from '@/lib/db/repository';
import { newId } from '@/lib/id';
import type { MuscleGroup, PlanInput, PlannedDay, Profile } from '@/types/domain';

export interface Ctx {
  db: Fit20DB;
  userId: string;
  /** Avisar al motor de sincronización que hay cambios para subir. */
  changed: () => void;
}

async function write(ctx: Ctx, writes: PendingWrite[]): Promise<void> {
  if ((await saveRecords(ctx.db, writes)) > 0) ctx.changed();
}

/** UUID estable derivado de un texto: el mismo favorito en dos dispositivos es UN solo registro. */
export async function stableId(seed: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // versión 8 (definida por la aplicación)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ───────── Planes ─────────

export interface PlanOptions {
  duration_days: number;
  start_date: string;
  include_running: boolean;
  focus_muscles: MuscleGroup[];
}

export function planInputFrom(profile: Profile, o: PlanOptions): PlanInput {
  return {
    goal: profile.primary_goal,
    level: profile.fitness_level,
    training_weekdays: profile.training_weekdays,
    session_minutes: profile.session_minutes,
    equipment: profile.equipment,
    focus_muscles: o.focus_muscles,
    running: { include: o.include_running, experience: profile.running_experience, max_distance_km: profile.max_run_distance_km },
    injuries: profile.injuries,
    duration_days: o.duration_days,
    start_date: o.start_date,
  };
}

export function planName(days: number): string {
  return `Plan de ${days} días`;
}

/** Crea un plan nuevo (archiva el activo) con todos sus días, en una sola transacción. */
export async function createPlan(ctx: Ctx, input: PlanInput): Promise<string> {
  const days = generatePlan(input);
  const planId = newId();
  const active = (await ctx.db.training_plans.where('status').anyOf('active', 'paused').toArray()).filter(alive);
  const writes: PendingWrite[] = active.map((p) => ({ entity: 'training_plans', record: { ...p, status: 'archived' } }));
  const plan: Omit<TrainingPlan, 'version' | 'updated_at'> = {
    id: planId,
    user_id: ctx.userId,
    name: planName(input.duration_days),
    goal: input.goal,
    input,
    duration_days: input.duration_days,
    start_date: input.start_date,
    end_date: addDays(input.start_date, input.duration_days - 1),
    status: 'active',
    paused_at: null,
    deleted_at: null,
  };
  writes.push({ entity: 'training_plans', record: plan });
  for (const d of days) {
    const day: Omit<TrainingDay, 'version' | 'updated_at'> = {
      id: newId(),
      user_id: ctx.userId,
      plan_id: planId,
      date: d.date,
      day_number: d.day_number,
      session_type: d.session_type,
      status: 'pending',
      planned: d,
      readiness: null,
      notes: null,
      deleted_at: null,
    };
    writes.push({ entity: 'training_days', record: day });
  }
  await write(ctx, writes);
  return planId;
}

export async function setPlanStatus(ctx: Ctx, plan: L<TrainingPlan>, status: TrainingPlan['status']): Promise<void> {
  await write(ctx, [{ entity: 'training_plans', record: { ...plan, status, paused_at: status === 'paused' ? new Date().toISOString() : null } }]);
}

// ───────── Días ─────────

function dayWithPlanned(day: L<TrainingDay>, planned: PlannedDay): L<TrainingDay> {
  return { ...day, planned, session_type: planned.session_type };
}

export async function swapDayExercise(ctx: Ctx, day: L<TrainingDay>, index: number, exerciseId: string): Promise<void> {
  await write(ctx, [{ entity: 'training_days', record: dayWithPlanned(day, swapExercise(day.planned, index, exerciseId)) }]);
}

export async function skipDay(ctx: Ctx, day: L<TrainingDay>, skipped: boolean): Promise<void> {
  await write(ctx, [{ entity: 'training_days', record: { ...day, status: skipped ? 'skipped' : 'pending' } }]);
}

/** Intercambia una sesión con un día de descanso del mismo plan (nunca se apilan sesiones). */
export async function moveDay(ctx: Ctx, days: L<TrainingDay>[], from: L<TrainingDay>, toDate: string): Promise<void> {
  const swapped = rescheduleDay(
    days.map((d) => d.planned),
    from.date,
    toDate,
  );
  const target = days.find((d) => d.date === toDate)!;
  const newFrom = swapped.find((d) => d.date === from.date)!;
  const newTo = swapped.find((d) => d.date === toDate)!;
  await write(ctx, [
    { entity: 'training_days', record: { ...dayWithPlanned(from, newFrom), status: 'pending' } },
    { entity: 'training_days', record: { ...dayWithPlanned(target, newTo), status: 'pending' } },
  ]);
}

/** Aplica el chequeo previo (fatiga/dolor): solo reduce o reemplaza, nunca agrega. */
export async function applyReadiness(ctx: Ctx, day: L<TrainingDay>, plan: L<TrainingPlan>, report: ReadinessReport): Promise<ReturnType<typeof adjustForReadiness>> {
  const result = adjustForReadiness(day.planned, report, plan.input);
  await write(ctx, [
    {
      entity: 'training_days',
      record: {
        ...dayWithPlanned(day, result.day),
        readiness: {
          fatigue: report.fatigue,
          pain_regions: report.pain_regions,
          changes: result.changes,
          warnings: result.warnings,
          recommend_professional: result.recommend_professional,
          reported_at: new Date().toISOString(),
        },
      },
    },
  ]);
  return result;
}

// ───────── Entrenamientos ─────────

/** Inicia (o retoma) el entrenamiento de un día: crea el workout y sus ejercicios. */
export async function startWorkout(ctx: Ctx, day: L<TrainingDay>): Promise<string> {
  const existing = (await ctx.db.workouts.where('training_day_id').equals(day.id).toArray()).find((w) => alive(w) && w.status === 'started');
  if (existing) return existing.id;

  const workoutId = newId();
  const now = new Date().toISOString();
  const workout: Omit<Workout, 'version' | 'updated_at'> = {
    id: workoutId,
    user_id: ctx.userId,
    training_day_id: day.id,
    name: day.planned.title,
    category: day.session_type,
    estimated_duration_min: day.planned.estimated_minutes || null,
    status: 'started',
    started_at: now,
    completed_at: null,
    duration_seconds: null,
    rpe: null,
    notes: null,
    deleted_at: null,
  };
  const writes: PendingWrite[] = [
    { entity: 'workouts', record: workout },
    ...day.planned.exercises.map(
      (pe, i): PendingWrite => ({
        entity: 'workout_exercises',
        record: {
          id: newId(),
          user_id: ctx.userId,
          workout_id: workoutId,
          exercise_id: pe.exercise_id,
          order_index: i,
          sets: Math.min(20, Math.max(1, pe.sets)),
          repetitions: pe.reps,
          rest_seconds: Math.min(900, Math.max(0, pe.rest_seconds)),
          deleted_at: null,
        } satisfies Omit<WorkoutExercise, 'version' | 'updated_at'>,
      }),
    ),
    { entity: 'training_days', record: { ...day, status: 'started' } },
  ];
  await write(ctx, writes);
  return workoutId;
}

export interface SetInput {
  repetitions_completed: number | null;
  duration_seconds: number | null;
  weight_kg: number | null;
}

/** Registra (o corrige) una serie. El id es estable por ejercicio+número de serie. */
export async function logSet(ctx: Ctx, we: L<WorkoutExercise>, setNumber: number, values: SetInput): Promise<void> {
  const id = await stableId(`set:${we.id}:${setNumber}`);
  const prev = await ctx.db.exercise_sets.get(id);
  const record: Omit<ExerciseSet, 'version' | 'updated_at'> = {
    id,
    user_id: ctx.userId,
    workout_exercise_id: we.id,
    set_number: setNumber,
    repetitions_completed: values.repetitions_completed,
    duration_seconds: values.duration_seconds,
    weight_kg: values.weight_kg,
    completed_at: prev?.completed_at ?? new Date().toISOString(),
    deleted_at: null,
  };
  await write(ctx, [{ entity: 'exercise_sets', record }]);
}

export async function removeSet(ctx: Ctx, set: L<ExerciseSet>): Promise<void> {
  await write(ctx, [{ entity: 'exercise_sets', record: { ...set, deleted_at: new Date().toISOString() } }]);
}

export async function finishWorkout(ctx: Ctx, workout: L<Workout>, rpe: number | null, notes: string): Promise<void> {
  const end = new Date();
  const writes: PendingWrite[] = [
    {
      entity: 'workouts',
      record: {
        ...workout,
        status: 'completed',
        completed_at: end.toISOString(),
        duration_seconds: Math.max(0, Math.round((end.getTime() - Date.parse(workout.started_at)) / 1000)),
        rpe,
        notes: notes.trim() ? notes.trim().slice(0, 2000) : null,
      },
    },
  ];
  if (workout.training_day_id) {
    const day = await ctx.db.training_days.get(workout.training_day_id);
    if (day) writes.push({ entity: 'training_days', record: { ...day, status: 'completed' } });
  }
  await write(ctx, writes);
}

/** Cancelar: el entrenamiento queda como abandonado (no se borra) y el día vuelve a pendiente. */
export async function abandonWorkout(ctx: Ctx, workout: L<Workout>): Promise<void> {
  const writes: PendingWrite[] = [{ entity: 'workouts', record: { ...workout, status: 'abandoned', completed_at: new Date().toISOString() } }];
  if (workout.training_day_id) {
    const day = await ctx.db.training_days.get(workout.training_day_id);
    if (day && day.status === 'started') writes.push({ entity: 'training_days', record: { ...day, status: 'pending' } });
  }
  await write(ctx, writes);
}

/** Marcar como hecho un día sin registro detallado (carrera o recuperación). */
export async function completeDay(ctx: Ctx, day: L<TrainingDay>, done: boolean): Promise<void> {
  await write(ctx, [{ entity: 'training_days', record: { ...day, status: done ? 'completed' : 'pending' } }]);
}

// ───────── Favoritos ─────────

export async function toggleFavorite(ctx: Ctx, exerciseId: string, on: boolean): Promise<void> {
  if (!getExercise(exerciseId)) return;
  const id = await stableId(`fav:${ctx.userId}:${exerciseId}`);
  const prev = await ctx.db.exercise_favorites.get(id);
  if (!on && !prev) return;
  await write(ctx, [{ entity: 'exercise_favorites', record: { ...(prev ?? {}), id, user_id: ctx.userId, exercise_id: exerciseId, deleted_at: on ? null : new Date().toISOString() } }]);
}

// ───────── Consultas ─────────

export interface PastSet {
  date: string;
  sets: { reps: number | null; seconds: number | null; kg: number | null }[];
}

/** Última vez que se hizo un ejercicio (para progresar: "la vez pasada hiciste…"). */
export async function lastPerformance(db: Fit20DB, exerciseId: string, excludeWorkoutId?: string): Promise<PastSet | null> {
  const wes = (await db.workout_exercises.where('exercise_id').equals(exerciseId).toArray()).filter((w) => alive(w) && w.workout_id !== excludeWorkoutId);
  let best: { w: L<Workout>; we: L<WorkoutExercise> } | null = null;
  for (const we of wes) {
    const w = await db.workouts.get(we.workout_id);
    if (!alive(w) || w.status !== 'completed') continue;
    if (!best || w.started_at > best.w.started_at) best = { w, we };
  }
  if (!best) return null;
  const sets = (await db.exercise_sets.where('workout_exercise_id').equals(best.we.id).toArray()).filter(alive).sort((a, b) => a.set_number - b.set_number);
  if (!sets.length) return null;
  return { date: best.w.started_at.slice(0, 10), sets: sets.map((s) => ({ reps: s.repetitions_completed, seconds: s.duration_seconds, kg: s.weight_kg })) };
}
