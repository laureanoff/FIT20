import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_PRESETS,
  PlanValidationError,
  adjustForReadiness,
  alternativesFor,
  applyDeload,
  detectFatigue,
  generatePlan,
  rescheduleDay,
  swapExercise,
} from '../../src/core/planning/engine.ts';
import { getExercise, isAvailable } from '../../src/data/exercises/index.ts';
import { addDays, weekday } from '../../src/core/utils/date.ts';
import type { Equipment, FitnessLevel, PlanInput, PlannedDay, PrimaryGoal } from '../../src/types/domain.ts';

const base: PlanInput = {
  goal: 'lose_fat',
  level: 'intermediate',
  training_weekdays: [1, 2, 3, 5, 6],
  session_minutes: 45,
  equipment: ['dumbbells', 'bands'],
  focus_muscles: [],
  running: { include: true, experience: 'regular', max_distance_km: 6 },
  injuries: [],
  duration_days: 28,
  start_date: '2026-11-09',
};

const MAJOR = new Set(['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes']);
// Las tracciones horizontales (p. ej. face pull, deltoides POSTERIOR) cuentan como espalda:
// no compiten con el press de hombros (deltoides anterior/medio) del día de empuje anterior.
const majors = (d: PlannedDay) =>
  new Set(
    d.exercises
      .map((e) => getExercise(e.exercise_id)!)
      .filter((e) => e.type === 'strength')
      .map((e) => (e.pattern === 'horizontal_pull' ? 'back' : e.primary_muscle))
      .filter((m) => MAJOR.has(m)),
  );
const isStrength = (d: PlannedDay) => d.session_type === 'strength' || d.session_type === 'strength_run';
const isHard = (d: PlannedDay) => d.session_type !== 'rest' && d.session_type !== 'active_recovery';

/** Matriz amplia de perfiles para probar invariantes, no casos sueltos. */
function* profiles(): Generator<PlanInput> {
  const goals: PrimaryGoal[] = ['lose_fat', 'lose_weight', 'gain_muscle', 'endurance', 'fitness', 'maintain', 'recomposition'];
  const levels: FitnessLevel[] = ['beginner', 'intermediate', 'advanced'];
  const equips: Equipment[][] = [[], ['dumbbells'], ['bands'], ['weighted_backpack'], ['pullup_bar'], ['gym']];
  const weekdaySets = [[1, 3, 5], [1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6], [6], [2, 4], [1, 2, 4, 5, 6, 0]];
  let i = 0;
  for (const goal of goals)
    for (const level of levels)
      for (const equipment of equips) {
        const wd = weekdaySets[i % weekdaySets.length]!;
        i++;
        yield {
          ...base,
          goal,
          level,
          equipment,
          training_weekdays: wd,
          session_minutes: [30, 45, 60, 90][i % 4]!,
          running: { include: i % 3 !== 0, experience: (['none', 'occasional', 'regular', 'experienced'] as const)[i % 4]!, max_distance_km: [0.5, 3, 8, 15][i % 4]! },
          injuries: i % 5 === 0 ? ['knee'] : i % 7 === 0 ? ['shoulder', 'lower_back'] : [],
          duration_days: 42,
        };
      }
}

test('genera exactamente la duración pedida con fechas consecutivas (todos los presets)', () => {
  for (const n of [...PLAN_PRESETS, 1, 45]) {
    const plan = generatePlan({ ...base, duration_days: n });
    assert.equal(plan.length, n);
    plan.forEach((d, i) => {
      assert.equal(d.date, addDays(base.start_date, i));
      assert.equal(d.day_number, i + 1);
    });
  }
});

test('es determinístico: mismo input → mismo plan', () => {
  assert.deepEqual(generatePlan(base), generatePlan(base));
});

test('valida el input', () => {
  assert.throws(() => generatePlan({ ...base, duration_days: 0 }), PlanValidationError);
  assert.throws(() => generatePlan({ ...base, training_weekdays: [] }), PlanValidationError);
  assert.throws(() => generatePlan({ ...base, session_minutes: 5 }), PlanValidationError);
});

test('invariantes sobre 126 perfiles distintos', () => {
  let checked = 0;
  for (const input of profiles()) {
    const plan = generatePlan(input);
    const inj = new Set(input.injuries);
    const selected = new Set(input.training_weekdays);
    const maxConsec = input.level === 'beginner' ? 2 : 3;

    for (let i = 0; i < plan.length; i++) {
      const d = plan[i]!;
      // Solo se entrena los días elegidos.
      if (!selected.has(weekday(d.date))) assert.equal(d.session_type, 'rest', `${d.date} no elegido`);
      // Ejercicios válidos, con el equipamiento disponible y sin cargar zonas lesionadas.
      for (const pe of d.exercises) {
        const ex = getExercise(pe.exercise_id);
        assert.ok(ex, `ejercicio inexistente ${pe.exercise_id}`);
        assert.ok(isAvailable(ex, input.equipment), `${ex.id} requiere equipamiento que no hay`);
        assert.ok(!ex.stress_regions.some((r) => inj.has(r)), `${ex.id} carga una zona lesionada`);
        assert.ok(pe.sets >= 1 && pe.sets <= 5);
        assert.ok(pe.rest_seconds >= 0 && pe.rest_seconds <= 180);
      }
      // Sin running si no lo pidió.
      if (!input.running.include) assert.equal(d.run, null);
      // Fuerza: tiempo estimado razonable para la sesión.
      if (d.session_type === 'strength') assert.ok(d.estimated_minutes <= input.session_minutes * 1.25 + 5, `${d.estimated_minutes} > ${input.session_minutes}`);
      // Recuperación muscular: dos días seguidos de fuerza no cargan los mismos grupos grandes.
      const prev = plan[i - 1];
      if (prev && isStrength(prev) && isStrength(d)) {
        const overlap = [...majors(d)].filter((m) => majors(prev).has(m));
        assert.deepEqual(overlap, [], `${prev.date}→${d.date} repite ${overlap.join(',')}`);
      }
      // Rachas de días exigentes acotadas por nivel.
      let streak = 0;
      for (let j = i; j >= 0 && isHard(plan[j]!); j--) streak++;
      assert.ok(streak <= maxConsec, `racha de ${streak} días exigentes`);
    }
    // Al menos un descanso completo por semana completa.
    for (let w = 0; w + 7 <= plan.length; w += 7) {
      assert.ok(plan.slice(w, w + 7).some((d) => d.session_type === 'rest'), `semana ${w / 7} sin descanso`);
    }
    checked++;
  }
  assert.equal(checked, 126);
});

test('running: el volumen semanal nunca sube más de 10% entre semanas de carga', () => {
  for (const max of [3, 5, 8, 12, 21]) {
    const plan = generatePlan({ ...base, duration_days: 84, running: { include: true, experience: 'regular', max_distance_km: max }, session_minutes: 90 });
    const weekly: number[] = [];
    for (let w = 0; w < 12; w++) weekly.push(plan.slice(w * 7, w * 7 + 7).reduce((a, d) => a + (d.run?.distance_km ?? 0), 0));
    let lastLoad = weekly[0]!;
    for (let w = 1; w < 12; w++) {
      if (w % 4 === 3) {
        assert.ok(weekly[w]! < lastLoad, `descarga semana ${w}: ${weekly[w]} no baja de ${lastLoad}`);
        continue;
      }
      assert.ok(weekly[w]! <= lastLoad * 1.1 + 1e-9, `max ${max}: semana ${w} ${weekly[w]} vs ${lastLoad}`);
      lastLoad = weekly[w]!;
    }
  }
});

test('running: el fondo inicial no supera lo que la persona puede correr hoy', () => {
  for (const max of [2, 3, 4, 6, 10]) {
    const plan = generatePlan({ ...base, running: { include: true, experience: 'occasional', max_distance_km: max } });
    const firstWeekRuns = plan.slice(0, 7).filter((d) => d.run).map((d) => d.run!.distance_km);
    assert.ok(firstWeekRuns.length > 0);
    assert.ok(Math.max(...firstWeekRuns) <= max, `max ${max}: ${firstWeekRuns}`);
  }
});

test('running: quien no corre arranca con trote y caminata', () => {
  const plan = generatePlan({ ...base, level: 'beginner', running: { include: true, experience: 'none', max_distance_km: 0 } });
  const runs = plan.filter((d) => d.run);
  assert.ok(runs.length > 0);
  assert.ok(runs.every((d) => d.run!.type === 'run_walk'));
});

test('principiante: sin intervalos las primeras dos semanas', () => {
  const plan = generatePlan({ ...base, level: 'beginner' });
  assert.ok(plan.slice(0, 14).every((d) => !d.run || (d.run.type !== 'intervals' && d.run.type !== 'tempo')));
});

test('progresión de fuerza: semana 3 suma volumen y semana 4 descarga', () => {
  const plan = generatePlan({ ...base, running: { ...base.running, include: false } });
  const sets = (w: number) => plan.slice(w * 7, w * 7 + 7).flatMap((d) => d.exercises.filter(() => isStrength(d))).reduce((a, e) => a + e.sets, 0);
  assert.ok(sets(2) > sets(0), 'semana 3 debería tener más series');
  assert.ok(sets(3) < sets(0), 'semana 4 es de descarga');
  assert.ok(plan.slice(21, 28).every((d) => d.is_deload));
});

test('grupos musculares priorizados aparecen en el plan', () => {
  const plan = generatePlan({ ...base, equipment: ['gym'], focus_muscles: ['glutes'], session_minutes: 60, running: { ...base.running, include: false } });
  const glute = plan.flatMap((d) => d.exercises).filter((e) => getExercise(e.exercise_id)!.primary_muscle === 'glutes').length;
  assert.ok(glute >= 4, `solo ${glute} ejercicios de glúteos`);
});

test('dolor: reemplaza ejercicios, suspende carrera y recomienda evaluación profesional', () => {
  const plan = generatePlan({ ...base, equipment: ['gym'] });
  const strength = plan.find((d) => d.session_type === 'strength' && d.exercises.some((e) => getExercise(e.exercise_id)!.stress_regions.includes('knee')))!;
  const r = adjustForReadiness(strength, { fatigue: 2, pain_regions: ['knee'] }, base);
  assert.ok(r.recommend_professional);
  assert.ok(r.warnings.length > 0);
  assert.ok(r.day.exercises.every((e) => !getExercise(e.exercise_id)!.stress_regions.includes('knee')));

  const run = plan.find((d) => d.session_type === 'run')!;
  const rr = adjustForReadiness(run, { fatigue: 1, pain_regions: ['ankle'] }, base);
  assert.equal(rr.day.run, null);
  assert.equal(rr.day.session_type, 'active_recovery');
});

test('fatiga: 4 reduce volumen, 5 convierte en recuperación', () => {
  const plan = generatePlan(base);
  const s = plan.find((d) => d.session_type === 'strength')!;
  const r4 = adjustForReadiness(s, { fatigue: 4, pain_regions: [] }, base);
  const total = (d: PlannedDay) => d.exercises.reduce((a, e) => a + e.sets, 0);
  assert.ok(total(r4.day) < total(s));
  const r5 = adjustForReadiness(s, { fatigue: 5, pain_regions: [] }, base);
  assert.equal(r5.day.session_type, 'active_recovery');

  const run = plan.find((d) => d.run && d.session_type === 'run')!;
  const rr = adjustForReadiness(run, { fatigue: 4, pain_regions: [] }, base);
  assert.ok(rr.day.run!.distance_km < run.run!.distance_km);
});

test('detección de fatiga acumulada', () => {
  assert.equal(detectFatigue([{ rpe: 6, fatigue: 2 }, { rpe: 7, fatigue: 2 }]), 'none');
  assert.equal(detectFatigue([{ rpe: 9, fatigue: 2 }, { rpe: 9, fatigue: 3 }]), 'reduce');
  assert.equal(detectFatigue([{ rpe: 9, fatigue: 4 }, { rpe: 10, fatigue: 4 }, { rpe: 9, fatigue: 5 }]), 'deload');
  const plan = generatePlan(base);
  const deloaded = applyDeload(plan, plan[0]!.date);
  const sets = (p: PlannedDay[]) => p.slice(0, 7).flatMap((d) => d.exercises).reduce((a, e) => a + e.sets, 0);
  assert.ok(sets(deloaded) < sets(plan));
  assert.deepEqual(deloaded.slice(7), plan.slice(7));
});

test('reprogramar: solo a días de descanso y sin duplicar sesiones', () => {
  const plan = generatePlan(base);
  const session = plan.find((d) => d.session_type === 'strength')!;
  const rest = plan.find((d) => d.session_type === 'rest' && d.date > session.date)!;
  const moved = rescheduleDay(plan, session.date, rest.date);
  assert.equal(moved.find((d) => d.date === session.date)!.session_type, 'rest');
  assert.equal(moved.find((d) => d.date === rest.date)!.title, session.title);
  const count = (p: PlannedDay[]) => p.filter((d) => d.session_type !== 'rest').length;
  assert.equal(count(moved), count(plan));
  const other = plan.find((d) => d.session_type === 'run')!;
  assert.throws(() => rescheduleDay(plan, session.date, other.date), /descanso/);
});

test('cambiar ejercicio: alternativas del mismo patrón y compatibles', () => {
  const alts = alternativesFor('goblet-squat', { equipment: [], injuries: [] });
  assert.ok(alts.length > 0);
  assert.ok(alts.every((a) => a.pattern === 'squat' && isAvailable(a, [])));
  assert.ok(alternativesFor('goblet-squat', { equipment: [], injuries: ['knee'] }).every((a) => !a.stress_regions.includes('knee')));
  const plan = generatePlan(base);
  const s = plan.find((d) => d.exercises.length > 0 && d.session_type === 'strength')!;
  const swapped = swapExercise(s, 0, alts[0]!.id);
  assert.equal(swapped.exercises[0]!.exercise_id, alts[0]!.id);
  assert.notEqual(s.exercises[0]!.exercise_id, alts[0]!.id); // el original no se muta
});
