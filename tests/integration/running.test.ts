import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Fit20DB, alive } from '@/lib/db/database';
import type { Ctx } from '@/features/training/actions';
import { RunTooShortError, addLivePoint, deleteRun, discardRun, downsample, finishRun, getActiveRun, localDateOf, pauseRun, prepareRun, saveManualRun, startRun } from '@/features/running/actions';
import { currentPace } from '@/features/running/LiveRunScreen';
import { weeklyKm } from '@/features/running/RunningScreens';

const UID = '44444444-4444-4444-8444-444444444444';
let db: Fit20DB;
let ctx: Ctx;
beforeEach(async () => {
  db = new Fit20DB(`${UID}-${Math.random()}`);
  await db.open();
  ctx = { db, userId: UID, changed: () => {} };
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const noTarget = { training_day_id: null, run_type: null, target_distance_km: null, target_duration_seconds: null };
// ~11,1 m por cada 0,0001° de latitud.
const at = (i: number) => ({ lat: -32.95 + i * 0.0001, lng: -60.65, accuracy: 5 });

describe('carrera con GPS', () => {
  it('suma distancia solo con el cronómetro corriendo, separa segmentos y guarda parciales', async () => {
    let run = await prepareRun(db, noTarget);
    expect(await addLivePoint(db, run, at(0), 0)).toBeNull(); // todavía no empezó

    const t0 = 1_000_000;
    run = await startRun(db, run, t0);
    // 1,2 km a ~5:00/km: 108 puntos cada 3,33 s
    let t = t0;
    for (let i = 0; i <= 60; i++) await addLivePoint(db, run, at(i), (t = t0 + i * 3333));
    run = await pauseRun(db, run, t + 1000);
    // En pausa: se ignora aunque el GPS "se mueva".
    expect(await addLivePoint(db, run, at(500), t + 5000)).toBeNull();
    const t1 = t + 60_000;
    run = await startRun(db, run, t1);
    expect(run.segment).toBe(1);
    for (let i = 61; i <= 108; i++) await addLivePoint(db, run, at(i), t1 + (i - 61) * 3333);

    // Reabrir la app: la carrera sigue ahí.
    expect((await getActiveRun(db))?.id).toBe(run.id);

    const id = await finishRun(ctx, run, { rpe: 6, notes: ' bien ' }, t1 + 48 * 3333);
    const s = (await db.running_sessions.get(id))!;
    // 60 tramos + 47 tramos de ~11,1 m (el salto entre segmentos no cuenta)
    expect(s.distance_km).toBeGreaterThan(1.15);
    expect(s.distance_km).toBeLessThan(1.22);
    expect(s.duration_seconds).toBe(Math.round((60 * 3333 + 1000 + 48 * 3333) / 1000));
    expect(s.source).toBe('gps');
    expect(s.notes).toBe('bien');
    expect(await db.running_splits.where('session_id').equals(id).count()).toBe(1);
    const track = (await db.running_tracks.where('session_id').equals(id).toArray())[0]!;
    expect(track.points[0]).toHaveLength(5);
    expect(await getActiveRun(db)).toBeUndefined();
    expect(await db.live_points.count()).toBe(0);
  });

  it('no guarda una carrera sin distancia', async () => {
    let run = await prepareRun(db, noTarget);
    run = await startRun(db, run, 0);
    await addLivePoint(db, run, at(0), 1000);
    await expect(finishRun(ctx, run, { rpe: null, notes: '' }, 5000)).rejects.toBeInstanceOf(RunTooShortError);
    await discardRun(db);
    expect(await getActiveRun(db)).toBeUndefined();
  });

  it('el ritmo actual usa la ventana reciente', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ elapsed_ms: i * 5000 }));
    const cum = pts.map((_, i) => i * 25); // 25 m cada 5 s → 3:20/km
    expect(Math.round(currentPace(pts, cum)!)).toBe(200);
    expect(currentPace(pts.slice(0, 1), cum.slice(0, 1))).toBeNull();
  });

  it('reduce recorridos larguísimos conservando los extremos', () => {
    const d = downsample(Array.from({ length: 1000 }, (_, i) => i), 100);
    expect(d).toHaveLength(100);
    expect(d[0]).toBe(0);
    expect(d[99]).toBe(999);
  });
});

describe('carrera manual y estadísticas', () => {
  it('guarda, completa el día del plan y se borra con sus partes', async () => {
    const dayId = '55555555-5555-4555-8555-555555555555';
    await db.training_days.put({
      id: dayId, user_id: UID, plan_id: 'p', date: '2026-11-05', day_number: 1, session_type: 'run', status: 'pending',
      planned: { date: '2026-11-05', day_number: 1, session_type: 'run', title: 'Running', exercises: [], run: null, estimated_minutes: 30, intensity: '', instructions: [], is_deload: false } as never,
      readiness: null, notes: null, version: 1, updated_at: '', deleted_at: null, _server_version: 1,
    });
    const id = await saveManualRun(ctx, { session_date: '2026-11-05', distance_km: 5.2, duration_seconds: 1710, rpe: null, notes: '', target: { ...noTarget, training_day_id: dayId } });
    expect((await db.training_days.get(dayId))!.status).toBe('completed');
    await deleteRun(ctx, (await db.running_sessions.get(id))!);
    expect(alive(await db.running_sessions.get(id))).toBe(false);
  });

  it('agrupa km por semana de lunes a domingo', () => {
    const w = weeklyKm(
      [
        { session_date: '2026-11-02', distance_km: 5 },
        { session_date: '2026-11-05', distance_km: 3.3 },
        { session_date: '2026-11-01', distance_km: 10 },
      ],
      '2026-11-05',
      2,
    );
    expect(w).toEqual([
      { week: '2026-10-26', km: 10 },
      { week: '2026-11-02', km: 8.3 },
    ]);
  });

  it('usa la fecha local del dispositivo', () => {
    expect(localDateOf(new Date(2026, 10, 5, 23, 30).toISOString())).toBe('2026-11-05');
  });
});
