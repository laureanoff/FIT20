import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceFor, bestHour, describeCode, openMeteoUrl, parseOpenMeteo, roundCoord, shortSummary } from '../../src/core/weather/weather.ts';
import { composeReminder, isDue, localParts, type DayInfo } from '../../src/core/notify/compose.ts';

const sample = {
  latitude: -32.86,
  longitude: -68.85,
  timezone: 'America/Argentina/Mendoza',
  current: { time: '2026-11-06T08:30', temperature_2m: 15.3, apparent_temperature: 11.6, weather_code: 0, wind_speed_10m: 16.1, is_day: 1 },
  hourly: {
    time: Array.from({ length: 24 }, (_, i) => `2026-11-06T${String(i).padStart(2, '0')}:00`),
    temperature_2m: [21, 21, 20, 20, 19, 17, 15, 14, 15, 15.6, 16, 17, 18, 19, 18, 17.6, 16.6, 15.6, 14.6, 13, 12, 11, 11, 11],
    weather_code: Array(24).fill(0),
    precipitation_probability: [2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 16, 25, 33, 40, 47, 55, 64],
    wind_speed_10m: Array(24).fill(10),
  },
  daily: {
    time: ['2026-11-06', '2026-11-07'],
    weather_code: [51, 63],
    temperature_2m_max: [19, 14],
    temperature_2m_min: [11, 8],
    precipitation_probability_max: [64, 90],
    wind_speed_10m_max: [20, 35],
    uv_index_max: [8, 3],
  },
};

test('clima: interpreta Open-Meteo desde la hora actual', () => {
  const f = parseOpenMeteo(sample, '2026-11-06T11:30:00Z');
  assert.equal(f.now.temp, 15.3);
  assert.equal(f.hours[0]!.time, '2026-11-06T08:00');
  assert.equal(f.hours.length, 16);
  assert.equal(f.days[1]!.precipProbMax, 90);
  assert.match(shortSummary(f), /^Despejado · 15° \(máx 19°\)$/);
  assert.throws(() => parseOpenMeteo({}));
  assert.equal(describeCode(95).kind, 'storm');
  assert.equal(describeCode(81).label, 'Chaparrones');
  assert.equal(roundCoord(-32.86471), -32.86);
  assert.match(openMeteoUrl(-32.864712, -68.849461), /latitude=-32\.86&longitude=-68\.85/);
});

test('clima: consejos según actividad', () => {
  const lluvia = { temp: 18, code: 63, windKmh: 10, precipProb: 80 };
  assert.match(adviceFor('run', lluvia)[0]!.text, /cinta/);
  assert.match(adviceFor('bike', lluvia)[0]!.text, /piso mojado/);
  assert.equal(adviceFor('strength', lluvia)[0]!.level, 'ok'); // fuerza es bajo techo
  assert.equal(adviceFor('run', { temp: 34, code: 0, windKmh: 5, precipProb: 0 })[0]!.level, 'warn');
  assert.match(adviceFor('bike', { temp: 18, code: 1, windKmh: 38, precipProb: 0 })[0]!.text, /contra el viento/);
  assert.equal(adviceFor('walk', { temp: 18, code: 95, windKmh: 10, precipProb: 90 })[0]!.text.startsWith('Tormenta'), true);
  assert.deepEqual(adviceFor('walk', { temp: 16, code: 1, windKmh: 8, precipProb: 0 }), [{ level: 'ok', text: 'Buen clima para salir.' }]);
  assert.ok(adviceFor('run', { temp: 40, code: 95, windKmh: 50, precipProb: 99, uv: 11 }).length <= 3);
});

test('clima: mejor hora evita la lluvia y la noche', () => {
  const f = parseOpenMeteo(sample);
  const best = bestHour(f.hours)!;
  const h = Number(best.time.slice(11, 13));
  assert.ok(h >= 8 && h <= 17, `hora ${h}`);
  assert.ok(best.precipProb < 20);
  assert.equal(bestHour([]), null);
});

test('avisos: vencen una sola vez por día dentro de la ventana', () => {
  assert.equal(isDue('07:30', '07:30', '2026-11-06', null), true);
  assert.equal(isDue('07:44', '07:30', '2026-11-06', '2026-11-05'), true);
  assert.equal(isDue('07:45', '07:30', '2026-11-06', null), false);
  assert.equal(isDue('07:29', '07:30', '2026-11-06', null), false);
  assert.equal(isDue('07:35', '07:30', '2026-11-06', '2026-11-06'), false);
  assert.deepEqual(localParts(new Date('2026-11-06T11:40:00Z'), 'America/Argentina/Buenos_Aires'), { date: '2026-11-06', time: '08:40' });
  assert.deepEqual(localParts(new Date('2026-11-07T02:10:00Z'), 'America/Argentina/Buenos_Aires'), { date: '2026-11-06', time: '23:10' });
});

test('avisos: texto de la mañana y de la noche', () => {
  const f = parseOpenMeteo(sample);
  const combo: DayInfo = { id: 'd1', session_type: 'strength_run', status: 'pending', title: 'Fuerza · Cuerpo completo + bici', estimated_minutes: 49, run_activity: 'bike' };
  const m = composeReminder('morning', combo, f, true)!;
  assert.equal(m.title, 'Hoy toca entrenar');
  assert.match(m.body, /^Fuerza · Cuerpo completo \+ bici · ~49 min\. Despejado, 15°/);
  assert.match(m.body, /Mejor hora para salir: \d+ h/);
  assert.match(m.body, /piso mojado|lluvia/i); // 64% de lluvia en el día
  assert.equal(m.url, '/entrenar/dia/d1');

  const sinClima = composeReminder('morning', combo, f, false)!;
  assert.equal(sinClima.body, 'Fuerza · Cuerpo completo + bici · ~49 min.');

  const run: DayInfo = { id: 'd2', session_type: 'run', status: 'pending', title: 'Caminata · Ritmo enérgico', estimated_minutes: 40, run_activity: 'walk', run_distance_km: 4.5 };
  assert.match(composeReminder('morning', run, null, true)!.body, /^Caminata · Ritmo enérgico · 4,5 km · ~40 min\.$/);

  assert.equal(composeReminder('morning', { ...combo, status: 'completed' }, f, true), null);
  assert.equal(composeReminder('evening', { ...combo, status: 'completed' }, f, true), null);
  assert.equal(composeReminder('evening', { ...combo, session_type: 'rest' }, f, true), null);
  assert.match(composeReminder('evening', combo, f, true)!.body, /movela/);
  assert.equal(composeReminder('morning', { ...combo, session_type: 'rest' }, null, true)!.title, 'Hoy es día de descanso');
  assert.equal(composeReminder('morning', null, null, true), null);
  assert.equal(composeReminder('morning', null, f, true)!.title, 'Clima de hoy');
});

test('la función de avisos usa la misma lógica que la app', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['notify/compose.ts', 'notify/live.ts', 'weather/weather.ts']) {
    assert.equal(readFileSync(`supabase/functions/send-reminders/core/${f}`, 'utf8'), readFileSync(`src/core/${f}`, 'utf8'), `${f} desactualizado: correr node scripts/sync-function-core.mjs`);
  }
});

test('clima guardado: se reubica en la hora pedida', async () => {
  const { forecastAt, trimForecast } = await import('../../src/core/weather/weather.ts');
  const f = parseOpenMeteo(sample);
  const later = forecastAt(f, '2026-11-06T19')!;
  assert.equal(later.now.temp, 13);
  assert.equal(later.now.precipProb, 33);
  assert.equal(later.now.isDay, true);
  assert.equal(forecastAt(f, '2026-11-06T22')!.now.isDay, false);
  assert.equal(later.hours.length, 5);
  assert.equal(forecastAt(f, '2026-11-08T07'), null);
  assert.equal(forecastAt(f, '2026-11-07T00'), null); // fuera de las horas descargadas
  assert.equal(trimForecast({ ...f, hours: Array(100).fill(f.hours[0]!) }).hours.length, 48);
});

test('notificación en vivo: tiempo real, distancia medida y estimada', async () => {
  const { composeLive, liveElapsed, clock } = await import('../../src/core/notify/live.ts');
  const base = { activity: 'run' as const, status: 'running' as const, elapsed_s: 600, updated_at: '2026-11-06T13:00:00Z', distance_km: 2, pace_s_per_km: 300, target_km: 8 };
  // 30 s después: todavía "en vivo", sin estimar
  let m = composeLive(base, new Date('2026-11-06T13:00:30Z'));
  assert.equal(m.title, 'Running · 10:30 · 2,00 km de 8');
  assert.equal(m.body, 'Ritmo medio 5:00/km');
  assert.equal(m.tag, 'fit20-live');
  // 10 min con el celu bloqueado: 600 s / 300 s/km = +2 km estimados
  m = composeLive(base, new Date('2026-11-06T13:10:00Z'));
  assert.equal(m.title, 'Running · 20:00 · ≈4,00 km de 8');
  assert.match(m.body, /^2,00 km medidos al bloquear/);
  // en pausa el tiempo no avanza
  assert.equal(liveElapsed({ ...base, status: 'paused' }, new Date('2026-11-06T14:00:00Z')), 600);
  assert.match(composeLive({ ...base, status: 'paused' }, new Date('2026-11-06T14:00:00Z')).title, /^Running en pausa · 10:00 · 2,00 km/);
  // bici: velocidad; sin ritmo todavía: sin estimación
  assert.match(composeLive({ ...base, activity: 'bike', pace_s_per_km: 150, target_km: null }, new Date('2026-11-06T13:00:10Z')).body, /Velocidad media 24 km\/h/);
  assert.equal(composeLive({ ...base, pace_s_per_km: null, target_km: null }, new Date('2026-11-06T13:05:00Z')).title, 'Running · 15:00 · 2,00 km');
  // más de 45 min sin datos: deja de estimar
  assert.match(composeLive(base, new Date('2026-11-06T14:00:00Z')).body, /Desbloqueá/);
  assert.equal(clock(3725), '1:02:05');
});
