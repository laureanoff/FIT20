import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateEnergy, mifflinStJeor } from '../../src/core/nutrition/energy.ts';
import { macrosFor, remaining, searchFoods, sumMacros, toGrams, validateCustomFood } from '../../src/core/nutrition/log.ts';
import { FOODS, getFood } from '../../src/data/foods/index.ts';
import {
  adjustCountdown, createCountdown, createStopwatch, elapsedMs, formatClock, formatCountdown, pauseCountdown, pauseStopwatch,
  remainingMs, resumeCountdown, startCountdown, startStopwatch, stopStopwatch, tickCountdown,
} from '../../src/core/timer/timer.ts';
import { accumulateTrack, computeSplits, formatPace, haversineM, parseDuration, personalBests, validateManualRun, type GpsPoint } from '../../src/core/running/track.ts';
import { activityStreak, goalProgress, monthlyTotals, valueAt, weeklyConsistency, weeklyTotals } from '../../src/core/stats/aggregate.ts';
import { ageFromBirthDate } from '../../src/core/utils/date.ts';

// ───────── Nutrición ─────────

const person = { age: 30, sex: 'male' as const, height_cm: 178, weight_kg: 82, weekly_training_minutes: 200, goal: 'lose_fat' as const };

test('Mifflin-St Jeor coincide con valores de referencia', () => {
  assert.equal(Math.round(mifflinStJeor('male', 82, 178, 30)), 1788);
  assert.equal(Math.round(mifflinStJeor('female', 60, 165, 30)), 1320);
});

test('no estima sin datos suficientes', () => {
  const r = estimateEnergy({ ...person, age: null, weight_kg: null });
  assert.equal(r.status, 'insufficient');
  assert.deepEqual(r.status === 'insufficient' && r.missing, ['edad', 'peso']);
});

test('déficit seguro: máx. 500 kcal y nunca bajo el metabolismo basal', () => {
  for (const w of [50, 70, 90, 130, 180]) {
    for (const sex of ['male', 'female'] as const) {
      const r = estimateEnergy({ ...person, weight_kg: w, sex, weekly_training_minutes: 0 });
      assert.equal(r.status, 'ok');
      if (r.status !== 'ok') return;
      assert.ok(r.tdee - r.target_kcal <= 505, `déficit ${r.tdee - r.target_kcal}`);
      assert.ok(r.target_kcal >= r.bmr - 5, `objetivo ${r.target_kcal} < basal ${r.bmr}`);
      assert.ok(r.carbs_g >= 0 && r.fat_g > 0 && r.protein_g > 0);
    }
  }
});

test('sin sexo biológico informa un rango en lugar de asumir', () => {
  const r = estimateEnergy({ ...person, sex: null });
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.ok(r.target_range && r.target_range[0] < r.target_range[1]);
  assert.ok(r.target_kcal >= r.target_range[0] && r.target_kcal <= r.target_range[1]);
});

test('menores de 18: sin déficit y con aviso', () => {
  const r = estimateEnergy({ ...person, age: 16 });
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.target_kcal, Math.round(r.tdee / 10) * 10);
  assert.ok(r.notes.some((n) => n.includes('menores')));
});

test('ganar músculo agrega superávit moderado', () => {
  const r = estimateEnergy({ ...person, goal: 'gain_muscle' });
  assert.ok(r.status === 'ok' && r.target_kcal > r.tdee && r.target_kcal - r.tdee <= 360);
});

test('porciones, gramos y crudo/cocido', () => {
  const huevo = getFood('huevo-entero')!;
  assert.equal(toGrams(huevo, 2, 'unidad'), 100);
  assert.equal(macrosFor(huevo, 2, 'unidad').kcal, 143);
  assert.throws(() => toGrams(huevo, 1, 'taza'));
  assert.throws(() => toGrams(huevo, 0, 'g'));
  const crudo = macrosFor(getFood('arroz-blanco-crudo')!, 100, 'g');
  const cocido = macrosFor(getFood('arroz-blanco-cocido')!, 100, 'g');
  assert.ok(crudo.kcal > cocido.kcal * 2.5, 'crudo y cocido deben diferir casi 3×');
});

test('totales y cuánto falta', () => {
  const t = sumMacros([{ kcal: 500, protein: 30, carbs: 50, fat: 10 }, { kcal: 300.4, protein: 20.05, carbs: 10, fat: 15 }]);
  assert.equal(t.kcal, 800);
  assert.deepEqual(remaining(t, { kcal: 2000, protein: 150, carbs: 200, fat: 60 }).kcal, 1200);
});

test('alimentos personalizados se validan', () => {
  assert.deepEqual(validateCustomFood({ name: 'Barrita', kcal: 400, protein: 20, carbs: 50, fat: 13 }), []);
  assert.ok(validateCustomFood({ name: 'X', kcal: 400, protein: 20, carbs: 50, fat: 13 }).length > 0);
  assert.ok(validateCustomFood({ name: 'Raro', kcal: 100, protein: 60, carbs: 60, fat: 0 }).length > 0);
  assert.ok(validateCustomFood({ name: 'Inconsistente', kcal: 900, protein: 10, carbs: 10, fat: 5 }).length > 0);
});

test('buscador sin acentos y con prioridad por inicio', () => {
  assert.equal(searchFoods(FOODS, 'platano').length, 0);
  assert.equal(searchFoods(FOODS, 'BROCOLI')[0]!.id.startsWith('brocoli'), true);
  assert.ok(searchFoods(FOODS, 'arroz cocido').every((f) => f.name.toLowerCase().includes('arroz')));
  assert.equal(searchFoods(FOODS, 'pollo')[0]!.name.startsWith('Pechuga') || searchFoods(FOODS, 'pollo')[0]!.name.includes('pollo'), true);
});

// ───────── Temporizadores ─────────

test('cuenta regresiva basada en timestamps (pantalla bloqueada no la rompe)', () => {
  let t = startCountdown(createCountdown(90_000), 1_000);
  assert.equal(remainingMs(t, 31_000), 60_000);
  // El JS estuvo congelado 5 minutos: al volver, terminó.
  t = tickCountdown(t, 301_000);
  assert.equal(t.status, 'done');
  assert.equal(remainingMs(t, 301_000), 0);
});

test('pausa, reanudar, ±15 s y nunca negativo', () => {
  let t = startCountdown(createCountdown(60_000), 0);
  t = pauseCountdown(t, 20_000);
  assert.equal(remainingMs(t, 999_999), 40_000); // pausado no corre
  t = resumeCountdown(t, 100_000);
  assert.equal(remainingMs(t, 110_000), 30_000);
  t = adjustCountdown(t, 15_000, 110_000);
  assert.equal(remainingMs(t, 110_000), 45_000);
  t = adjustCountdown(t, -60_000, 110_000);
  assert.equal(t.status, 'done');
  t = adjustCountdown(t, 15_000, 200_000); // +15 tras terminar: vuelve a correr
  assert.equal(remainingMs(t, 200_000), 15_000);
});

test('el estado del temporizador sobrevive a serialización (IndexedDB)', () => {
  const t = startCountdown(createCountdown(60_000), 1_000);
  const restored = JSON.parse(JSON.stringify(t));
  assert.equal(remainingMs(restored, 31_000), 30_000);
});

test('cronómetro con pausas', () => {
  let s = startStopwatch(createStopwatch(), 0);
  s = pauseStopwatch(s, 60_000);
  assert.equal(elapsedMs(s, 500_000), 60_000);
  s = startStopwatch(s, 500_000);
  assert.equal(elapsedMs(s, 530_000), 90_000);
  s = stopStopwatch(s, 540_000);
  assert.equal(elapsedMs(s, 9_999_999), 100_000);
  assert.equal(formatClock(3_725_000), '1:02:05');
  assert.equal(formatCountdown(9_200), '0:10');
});

// ───────── Running ─────────

test('haversine: 1 grado de latitud ≈ 111,2 km', () => {
  assert.ok(Math.abs(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111_195) < 50);
});

/** Recorrido sintético hacia el norte a ritmo constante (5:00 min/km), un punto cada 5 s. */
function syntheticRun(km: number, paceS = 300): GpsPoint[] {
  const pts: GpsPoint[] = [];
  const stepM = (1000 / paceS) * 5;
  const n = Math.round((km * 1000) / stepM);
  for (let i = 0; i <= n; i++) pts.push({ lat: -33.0 + (i * stepM) / 111_195, lng: -62.6, accuracy: 8, elapsed_ms: i * 5000, segment: 0 });
  return pts;
}

test('distancia GPS y filtrado de ruido', () => {
  const clean = syntheticRun(5);
  const base = accumulateTrack(clean).distance_m;
  assert.ok(Math.abs(base - 5000) < 20, `${base}`);
  const noisy = [...clean];
  noisy.splice(100, 0, { ...clean[100]!, lat: clean[100]!.lat + 0.01, elapsed_ms: clean[100]!.elapsed_ms + 1 }); // salto de 1 km
  noisy.splice(50, 0, { ...clean[50]!, accuracy: 120 }); // punto impreciso
  assert.ok(Math.abs(accumulateTrack(noisy).distance_m - base) < 30);
  const still = Array.from({ length: 60 }, (_, i): GpsPoint => ({ lat: -33 + (i % 2) * 0.00001, lng: -62.6, accuracy: 10, elapsed_ms: i * 1000, segment: 0 }));
  assert.equal(accumulateTrack(still).distance_m, 0, 'estando quieto no suma deriva');
});

test('pausa: no une puntos entre segmentos', () => {
  const a = syntheticRun(1).map((p) => ({ ...p }));
  const b = syntheticRun(1).map((p) => ({ ...p, lat: p.lat + 0.05, elapsed_ms: p.elapsed_ms + 300_000, segment: 1 }));
  const d = accumulateTrack([...a, ...b]).distance_m;
  assert.ok(Math.abs(d - 2000) < 20, `${d}`);
});

test('parciales por km', () => {
  const splits = computeSplits(accumulateTrack(syntheticRun(5.2)));
  assert.equal(splits.length, 5);
  for (const s of splits) assert.ok(Math.abs(s.duration_s - 300) <= 2, `${s.duration_s}`);
});

test('registro manual y ritmo', () => {
  assert.equal(parseDuration('25:30'), 1530);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration('25:75'), null);
  const r = validateManualRun({ distance_km: 5, duration: '25:00' });
  assert.ok(r.ok && formatPace(r.pace) === '5:00');
  assert.equal(validateManualRun({ distance_km: 10, duration: '10:00' }).ok, false);
  assert.equal(validateManualRun({ distance_km: 0, duration: '10:00' }).ok, false);
});

test('marcas personales', () => {
  const pb = personalBests([
    { session_date: '2026-11-01', distance_km: 5, duration_seconds: 1500, splits: [310, 300, 295, 305, 290].map((d, i) => ({ km: i + 1, duration_s: d })) },
    { session_date: '2026-11-03', distance_km: 10, duration_seconds: 3300 },
    { session_date: '2026-11-04', distance_km: 2, duration_seconds: 480 },
  ]);
  assert.equal(pb.longest_km, 10);
  assert.equal(pb.best_1k_s, 290);
  assert.equal(pb.best_5k_s, 1500);
  assert.equal(pb.fastest_pace_3k_plus, 300); // el de 2 km (4:00) no cuenta para ≥3 km
  assert.equal(pb.total_km, 17);
});

// ───────── Estadísticas ─────────

test('totales semanales/mensuales, racha, progreso y consistencia', () => {
  const w = weeklyTotals([{ date: '2026-11-02', value: 5 }, { date: '2026-11-04', value: 3 }, { date: '2026-11-16', value: 10 }], '2026-11-02', '2026-11-20');
  assert.deepEqual(w.map((x) => x.value), [8, 0, 10]);
  assert.deepEqual(monthlyTotals([{ date: '2026-10-30', value: 2 }, { date: '2026-11-01', value: 3 }]), [{ month: '2026-10', value: 2 }, { month: '2026-11', value: 3 }]);

  const active = new Set(['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-05']);
  assert.equal(activityStreak(active, '2026-11-05'), 2);
  assert.equal(activityStreak(active, '2026-11-05', new Set(['2026-11-03'])), 4); // descanso planificado no corta
  assert.equal(activityStreak(active, '2026-11-06'), 2); // hoy aún no entrenó: cuenta hasta ayer

  assert.equal(goalProgress(90, 85, 80), 0.5);
  assert.equal(goalProgress(60, 63, 66), 0.5); // subir de peso
  assert.equal(goalProgress(90, 92, 80), 0);

  assert.deepEqual(weeklyConsistency([{ date: '2026-11-02', done: true }, { date: '2026-11-04', done: false }]).map((x) => x.ratio), [0.5]);
  assert.equal(valueAt([{ date: '2026-11-01', v: 1 }, { date: '2026-11-08', v: 2 }], '2026-11-05')!.v, 1);
  assert.equal(ageFromBirthDate('1995-11-06', '2026-11-05'), 30);
});

test('GPS por actividad: en bici acepta 40 km/h; corriendo eso es un salto', async () => {
  const { accumulateTrack, ACTIVITY_LIMITS, validateManualRun, speedKmh } = await import('../../src/core/running/track.ts');
  // 11,1 m por cada 0,0001° de latitud; un punto por segundo = ~40 km/h
  const pts = Array.from({ length: 20 }, (_, i) => ({ lat: -32.95 + i * 0.0001, lng: -60.65, accuracy: 5, elapsed_ms: i * 1000, segment: 0 }));
  assert.ok(accumulateTrack(pts, ACTIVITY_LIMITS.bike.maxSpeedMps).distance_m > 200);
  assert.equal(accumulateTrack(pts, ACTIVITY_LIMITS.run.maxSpeedMps).distance_m, 0);
  assert.equal(accumulateTrack(pts).distance_m, 0); // por defecto, running
  assert.ok(validateManualRun({ distance_km: 30, duration: '1:00:00' }, 'bike').ok);
  assert.equal(validateManualRun({ distance_km: 30, duration: '1:00:00' }, 'run').ok, false);
  assert.ok(validateManualRun({ distance_km: 5, duration: '55:00' }, 'walk').ok);
  assert.equal(validateManualRun({ distance_km: 15, duration: '1:00:00' }, 'walk').ok, false);
  assert.equal(speedKmh(30, 3600), 30);
});
