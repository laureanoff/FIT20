import { ACTIVITY_LIMITS, type GpsPoint, accumulateTrack, computeSplits } from '@/core/running/track';
import type { CardioActivity } from '@/types/domain';
import { type Stopwatch, createStopwatch, elapsedMs, pauseStopwatch, startStopwatch, stopStopwatch } from '@/core/timer/timer';
import { type Fit20DB, type L, type LivePoint, type RunningSession, type TrackPoint, alive, getMeta, setMeta } from '@/lib/db/database';
import { type PendingWrite, saveRecords } from '@/lib/db/repository';
import { newId } from '@/lib/id';
import type { Ctx } from '@/features/training/actions';

/** Tope del servidor por recorrido; con un punto por segundo alcanza para ~14 h. */
export const MAX_TRACK_POINTS = 50_000;
const ACTIVE_KEY = 'active_run';

export interface ActiveRun {
  id: string;
  activity: CardioActivity;
  started_at: string;
  stopwatch: Stopwatch;
  segment: number;
  training_day_id: string | null;
  run_type: string | null;
  target_distance_km: number | null;
  target_duration_seconds: number | null;
}

async function write(ctx: Ctx, writes: PendingWrite[]): Promise<void> {
  if ((await saveRecords(ctx.db, writes)) > 0) ctx.changed();
}

export async function getActiveRun(db: Fit20DB): Promise<ActiveRun | undefined> {
  const r = await getMeta<ActiveRun>(db, ACTIVE_KEY);
  return r ? { ...r, activity: r.activity ?? 'run' } : undefined;
}

/** Cambiar la actividad antes de largar (mismo GPS, otros límites de velocidad). */
export async function setRunActivity(db: Fit20DB, run: ActiveRun, activity: CardioActivity): Promise<ActiveRun> {
  const next = { ...run, activity };
  await setActive(db, next);
  return next;
}

export const maxSpeedFor = (a: CardioActivity | undefined) => ACTIVITY_LIMITS[a ?? 'run'].maxSpeedMps;

async function setActive(db: Fit20DB, run: ActiveRun | null): Promise<void> {
  if (run) await setMeta(db, ACTIVE_KEY, run);
  else await db.meta.delete(ACTIVE_KEY);
}

export interface RunTarget {
  activity: CardioActivity;
  training_day_id: string | null;
  run_type: string | null;
  target_distance_km: number | null;
  target_duration_seconds: number | null;
}

/** Prepara una carrera (cronómetro detenido) a la espera de la señal GPS. */
export async function prepareRun(db: Fit20DB, target: RunTarget): Promise<ActiveRun> {
  const existing = await getActiveRun(db);
  if (existing) return existing;
  const run: ActiveRun = { id: newId(), started_at: new Date().toISOString(), stopwatch: createStopwatch(), segment: 0, ...target };
  await db.live_points.clear();
  await setActive(db, run);
  return run;
}

export async function startRun(db: Fit20DB, run: ActiveRun, now = Date.now()): Promise<ActiveRun> {
  const first = run.stopwatch.status === 'idle';
  const next: ActiveRun = {
    ...run,
    started_at: first ? new Date(now).toISOString() : run.started_at,
    // Al reanudar se abre un segmento nuevo: la distancia no "salta" a través de la pausa.
    segment: first ? 0 : run.segment + 1,
    stopwatch: startStopwatch(run.stopwatch, now),
  };
  await setActive(db, next);
  return next;
}

export async function pauseRun(db: Fit20DB, run: ActiveRun, now = Date.now()): Promise<ActiveRun> {
  const next = { ...run, stopwatch: pauseStopwatch(run.stopwatch, now) };
  await setActive(db, next);
  return next;
}

/** Guarda un punto solo si el cronómetro corre (en pausa no se suma distancia). */
export async function addLivePoint(db: Fit20DB, run: ActiveRun, pos: { lat: number; lng: number; accuracy: number }, now = Date.now()): Promise<LivePoint | null> {
  if (run.stopwatch.status !== 'running') return null;
  const p: LivePoint = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, elapsed_ms: elapsedMs(run.stopwatch, now), segment: run.segment };
  p.seq = await db.live_points.add(p);
  return p;
}

export async function discardRun(db: Fit20DB): Promise<void> {
  await db.live_points.clear();
  await setActive(db, null);
}

/** Reduce un recorrido demasiado largo conservando forma y extremos. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

export function toGps(p: LivePoint): GpsPoint {
  return { lat: p.lat, lng: p.lng, accuracy: p.accuracy, elapsed_ms: p.elapsed_ms, segment: p.segment };
}

export function fromTrack(t: TrackPoint): GpsPoint {
  return { lat: t[0], lng: t[1], elapsed_ms: t[2], accuracy: t[3], segment: t[4] };
}

export class RunTooShortError extends Error {
  constructor() {
    super('Todavía no se registró distancia. Esperá a tener señal GPS y moverte un poco, o registrala a mano.');
  }
}

/** Termina la carrera GPS: sesión + parciales + recorrido en una sola transacción. */
export async function finishRun(ctx: Ctx, run: ActiveRun, extra: { rpe: number | null; notes: string }, now = Date.now()): Promise<string> {
  const sw = stopStopwatch(run.stopwatch, now);
  const raw = (await ctx.db.live_points.orderBy('seq').toArray()).map(toGps);
  const track = accumulateTrack(raw, maxSpeedFor(run.activity));
  const distance_km = Math.round(track.distance_m) / 1000;
  const duration_seconds = Math.max(1, Math.round(elapsedMs(sw, now) / 1000));
  if (distance_km < 0.01) throw new RunTooShortError();

  const session: Omit<RunningSession, 'version' | 'updated_at'> = {
    id: run.id,
    user_id: ctx.userId,
    activity: run.activity ?? 'run',
    training_day_id: run.training_day_id,
    session_date: localDateOf(run.started_at),
    started_at: run.started_at,
    run_type: run.run_type,
    source: 'gps',
    distance_km: Math.min(300, distance_km),
    duration_seconds: Math.min(172_800, duration_seconds),
    target_distance_km: run.target_distance_km,
    target_duration_seconds: run.target_duration_seconds,
    rpe: extra.rpe,
    notes: extra.notes.trim() ? extra.notes.trim().slice(0, 2000) : null,
    deleted_at: null,
  };
  const writes: PendingWrite[] = [{ entity: 'running_sessions', record: session }];
  for (const s of computeSplits(track)) {
    if (s.duration_s <= 0) continue;
    writes.push({ entity: 'running_splits', record: { id: newId(), user_id: ctx.userId, session_id: run.id, kilometer: s.km, duration_seconds: s.duration_s, deleted_at: null } });
  }
  const points: TrackPoint[] = downsample(track.accepted, MAX_TRACK_POINTS).map((p) => [round6(p.lat), round6(p.lng), Math.round(p.elapsed_ms), Math.round(p.accuracy), p.segment]);
  if (points.length) writes.push({ entity: 'running_tracks', record: { id: newId(), user_id: ctx.userId, session_id: run.id, points, deleted_at: null } });
  if (run.training_day_id) {
    const day = await ctx.db.training_days.get(run.training_day_id);
    // En días de fuerza + cardio, el día se completa al terminar la fuerza (no solo con el cardio).
    if (alive(day) && !day.planned.exercises.length) writes.push({ entity: 'training_days', record: { ...day, status: 'completed' } });
  }
  await write(ctx, writes);
  await discardRun(ctx.db);
  return run.id;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Fecha local (Argentina u otra zona del dispositivo) de un instante ISO. */
export function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ManualRun {
  session_date: string;
  distance_km: number;
  duration_seconds: number;
  rpe: number | null;
  notes: string;
  target: RunTarget;
}

export async function saveManualRun(ctx: Ctx, r: ManualRun): Promise<string> {
  const id = newId();
  const writes: PendingWrite[] = [
    {
      entity: 'running_sessions',
      record: {
        id,
        user_id: ctx.userId,
        activity: r.target.activity,
        training_day_id: r.target.training_day_id,
        session_date: r.session_date,
        started_at: null,
        run_type: r.target.run_type,
        source: 'manual',
        distance_km: Math.round(r.distance_km * 1000) / 1000,
        duration_seconds: r.duration_seconds,
        target_distance_km: r.target.target_distance_km,
        target_duration_seconds: r.target.target_duration_seconds,
        rpe: r.rpe,
        notes: r.notes.trim() ? r.notes.trim().slice(0, 2000) : null,
        deleted_at: null,
      } satisfies Omit<RunningSession, 'version' | 'updated_at'>,
    },
  ];
  if (r.target.training_day_id) {
    const day = await ctx.db.training_days.get(r.target.training_day_id);
    // En días de fuerza + cardio, el día se completa al terminar la fuerza (no solo con el cardio).
    if (alive(day) && !day.planned.exercises.length) writes.push({ entity: 'training_days', record: { ...day, status: 'completed' } });
  }
  await write(ctx, writes);
  return id;
}

export async function updateRunNotes(ctx: Ctx, run: L<RunningSession>, patch: { rpe: number | null; notes: string }): Promise<void> {
  await write(ctx, [{ entity: 'running_sessions', record: { ...run, rpe: patch.rpe, notes: patch.notes.trim() ? patch.notes.trim().slice(0, 2000) : null } }]);
}

/** Borrado lógico de la carrera y sus partes (se propaga a todos los dispositivos). */
export async function deleteRun(ctx: Ctx, run: L<RunningSession>): Promise<void> {
  const now = new Date().toISOString();
  const splits = (await ctx.db.running_splits.where('session_id').equals(run.id).toArray()).filter(alive);
  const tracks = (await ctx.db.running_tracks.where('session_id').equals(run.id).toArray()).filter(alive);
  await write(ctx, [
    ...splits.map((s): PendingWrite => ({ entity: 'running_splits', record: { ...s, deleted_at: now } })),
    ...tracks.map((t): PendingWrite => ({ entity: 'running_tracks', record: { ...t, deleted_at: now } })),
    { entity: 'running_sessions', record: { ...run, deleted_at: now } },
  ]);
}
