import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Fit20DB, alive } from '@/lib/db/database';
import {
  type Ctx,
  abandonWorkout,
  applyReadiness,
  createPlan,
  finishWorkout,
  lastPerformance,
  logSet,
  moveDay,
  planInputFrom,
  stableId,
  startWorkout,
  toggleFavorite,
} from '@/features/training/actions';
import { targetFromReps } from '@/features/training/format';
import { filterExercises } from '@/features/training/LibraryScreens';
import { volumeKg } from '@/features/training/HistoryScreens';
import { EXERCISES } from '@/data/exercises';
import type { Profile } from '@/types/domain';

const UID = '33333333-3333-4333-8333-333333333333';

const profile: Profile = {
  id: UID,
  version: 1,
  updated_at: '',
  deleted_at: null,
  full_name: 'Lau',
  birth_date: '1995-03-10',
  sex: 'male',
  height_cm: 178,
  current_weight_kg: 82,
  target_weight_kg: 77,
  fitness_level: 'intermediate',
  running_experience: 'occasional',
  max_run_distance_km: 6,
  training_weekdays: [1, 3, 5, 6],
  session_minutes: 60,
  equipment: ['bodyweight', 'dumbbells'],
  dietary_preferences: [],
  dietary_restrictions: [],
  injuries: ['knee'],
  primary_goal: 'recomposition',
  onboarding_completed: true,
};

let db: Fit20DB;
let ctx: Ctx;
let changes = 0;
beforeEach(async () => {
  db = new Fit20DB(`${UID}-${Math.random()}`);
  await db.open();
  changes = 0;
  ctx = { db, userId: UID, changed: () => changes++ };
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const input = (days = 14) => planInputFrom(profile, { duration_days: days, start_date: '2026-11-02', include_running: true, focus_muscles: [] });

describe('planes en la base local', () => {
  it('crea el plan con todos sus días y una operación de sync por registro', async () => {
    const planId = await createPlan(ctx, input(14));
    const days = await db.training_days.where('plan_id').equals(planId).toArray();
    expect(days).toHaveLength(14);
    expect(new Set(days.map((d) => d.date)).size).toBe(14);
    expect(await db.outbox.count()).toBe(15);
    expect(changes).toBe(1);
    const plan = (await db.training_plans.get(planId))!;
    expect(plan.end_date).toBe('2026-11-15');
  });

  it('un plan nuevo archiva el anterior', async () => {
    const first = await createPlan(ctx, input(7));
    const second = await createPlan(ctx, input(30));
    expect((await db.training_plans.get(first))!.status).toBe('archived');
    expect((await db.training_plans.get(second))!.status).toBe('active');
  });

  it('mueve una sesión a un día de descanso sin apilar entrenamientos', async () => {
    const planId = await createPlan(ctx, input(14));
    const days = (await db.training_days.where('plan_id').equals(planId).toArray()).sort((a, b) => a.day_number - b.day_number);
    const session = days.find((d) => d.session_type !== 'rest')!;
    const rest = days.find((d) => d.session_type === 'rest' && d.date > session.date)!;
    await moveDay(ctx, days, session, rest.date);
    expect((await db.training_days.get(session.id))!.session_type).toBe('rest');
    expect((await db.training_days.get(rest.id))!.planned.title).toBe(session.planned.title);
  });

  it('el chequeo previo con fatiga alta reduce series y queda registrado', async () => {
    const planId = await createPlan(ctx, input(14));
    const plan = (await db.training_plans.get(planId))!;
    const day = (await db.training_days.where('plan_id').equals(planId).toArray()).find((d) => d.planned.exercises.length && d.session_type === 'strength')!;
    const before = day.planned.exercises.reduce((a, e) => a + e.sets, 0);
    const r = await applyReadiness(ctx, day, plan, { fatigue: 4, pain_regions: [] });
    const after = (await db.training_days.get(day.id))!;
    expect(r.changes.length).toBeGreaterThan(0);
    expect(after.planned.exercises.reduce((a, e) => a + e.sets, 0)).toBeLessThan(before);
    expect(after.readiness?.fatigue).toBe(4);
  });
});

describe('sesión de fuerza', () => {
  it('registra series, termina el día y recuerda la última marca', async () => {
    const planId = await createPlan(ctx, input(14));
    const day = (await db.training_days.where('plan_id').equals(planId).toArray()).find((d) => d.session_type === 'strength')!;
    const wid = await startWorkout(ctx, day);
    expect(await startWorkout(ctx, (await db.training_days.get(day.id))!)).toBe(wid); // retomar, no duplicar
    const wes = (await db.workout_exercises.where('workout_id').equals(wid).toArray()).sort((a, b) => a.order_index - b.order_index);
    expect(wes).toHaveLength(day.planned.exercises.length);

    const first = wes[0]!;
    await logSet(ctx, first, 1, { repetitions_completed: 10, duration_seconds: null, weight_kg: 12.5 });
    await logSet(ctx, first, 1, { repetitions_completed: 11, duration_seconds: null, weight_kg: 12.5 }); // corrección
    await logSet(ctx, first, 2, { repetitions_completed: 9, duration_seconds: null, weight_kg: 12.5 });
    const sets = (await db.exercise_sets.where('workout_exercise_id').equals(first.id).toArray()).filter(alive);
    expect(sets.map((s) => s.repetitions_completed).sort()).toEqual([11, 9].sort());
    expect(volumeKg(sets)).toBe(Math.round(12.5 * 20));

    await finishWorkout(ctx, (await db.workouts.get(wid))!, 7, '  buena  ');
    const w = (await db.workouts.get(wid))!;
    expect(w.status).toBe('completed');
    expect(w.notes).toBe('buena');
    expect((await db.training_days.get(day.id))!.status).toBe('completed');

    const past = await lastPerformance(db, first.exercise_id);
    expect(past?.sets).toEqual([
      { reps: 11, seconds: null, kg: 12.5 },
      { reps: 9, seconds: null, kg: 12.5 },
    ]);
  });

  it('cancelar deja el día pendiente y no borra nada', async () => {
    const planId = await createPlan(ctx, input(7));
    const day = (await db.training_days.where('plan_id').equals(planId).toArray()).find((d) => d.planned.exercises.length)!;
    const wid = await startWorkout(ctx, day);
    await abandonWorkout(ctx, (await db.workouts.get(wid))!);
    expect((await db.workouts.get(wid))!.status).toBe('abandoned');
    expect((await db.training_days.get(day.id))!.status).toBe('pending');
  });
});

describe('favoritos', () => {
  it('usan un id estable: marcar dos veces no duplica y desmarcar es borrado lógico', async () => {
    await toggleFavorite(ctx, 'push-up', true);
    await toggleFavorite(ctx, 'push-up', true);
    expect(await db.exercise_favorites.count()).toBe(1);
    await toggleFavorite(ctx, 'push-up', false);
    const fav = (await db.exercise_favorites.toArray())[0]!;
    expect(fav.deleted_at).not.toBeNull();
    expect(fav.id).toBe(await stableId(`fav:${UID}:push-up`));
  });
});

describe('utilidades', () => {
  it('interpreta la prescripción', () => {
    expect(targetFromReps('8-12')).toEqual({ reps: 8, seconds: null });
    expect(targetFromReps('10-12 por lado')).toEqual({ reps: 10, seconds: null });
    expect(targetFromReps('30-45 s')).toEqual({ reps: null, seconds: 30 });
    expect(targetFromReps('15-20 min')).toEqual({ reps: null, seconds: 900 });
  });

  it('busca ejercicios sin tildes y respeta el equipamiento', () => {
    const r = filterExercises(EXERCISES, 'sentadilla', null, ['bodyweight'], null);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => e.equipment.includes('bodyweight'))).toBe(true);
    expect(filterExercises(EXERCISES, 'FLEXION', 'chest', null, null).length).toBeGreaterThan(0);
  });
});
