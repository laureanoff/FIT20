import { useLiveQuery } from 'dexie-react-hooks';
import { Flag, LocateFixed, LocateOff, Map as MapIcon, Pause, Play, Square, Trash2 } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button, ErrorBox, Spinner, cx } from '@/components/ui';
import { useData } from '@/app/data';
import { accumulateTrack, computeSplits, formatPace, paceSecPerKm } from '@/core/running/track';
import type { CardioActivity } from '@/types/domain';
import { elapsedMs, formatClock } from '@/core/timer/timer';
import type { LivePoint } from '@/lib/db/database';
import { useCtx } from '@/features/training/hooks';
import { beep, primeAudio, useWakeLock } from '@/features/training/useRestTimer';
import { type ActiveRun, RunTooShortError, addLivePoint, discardRun, finishRun, getActiveRun, maxSpeedFor, pauseRun, prepareRun, setRunActivity, startRun, toGps } from './actions';
import { WeatherCard } from '@/features/weather/WeatherCard';
import { rememberLocation } from '@/features/weather/store';
import { ACTIVITIES, ACTIVITY_ICON, ACTIVITY_LABEL, ACTIVITY_NOUN, fmtSpeed, usesSpeed } from './activity';

const RouteMap = lazy(() => import('./RouteMap'));

type GpsState = { kind: 'waiting' } | { kind: 'ok'; accuracy: number } | { kind: 'denied' } | { kind: 'unavailable'; message: string };

const km = (m: number) => (m / 1000).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ritmo actual: últimos ~30 s de recorrido aceptado. */
export function currentPace(points: { elapsed_ms: number }[], cumulative: number[], windowMs = 30_000): number | null {
  const n = points.length;
  if (n < 2) return null;
  const end = points[n - 1]!.elapsed_ms;
  let i = n - 1;
  while (i > 0 && end - points[i - 1]!.elapsed_ms <= windowMs) i--;
  const d = cumulative[n - 1]! - cumulative[i]!;
  const t = (end - points[i]!.elapsed_ms) / 1000;
  return d >= 20 && t >= 5 ? paceSecPerKm(d / 1000, t) : null;
}

export function LiveRunScreen() {
  const { db, settings } = useData();
  const ctx = useCtx();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const dayId = params.get('dia');
  const wantedAct = (ACTIVITIES as string[]).includes(params.get('actividad') ?? '') ? (params.get('actividad') as CardioActivity) : null;
  const day = useLiveQuery(async () => (dayId ? ((await db.training_days.get(dayId)) ?? null) : null), [db, dayId]);

  const [run, setRun] = useState<ActiveRun | null>(null);
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [gps, setGps] = useState<GpsState>({ kind: 'waiting' });
  const [now, setNow] = useState(Date.now());
  const [showMap, setShowMap] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const runRef = useRef<ActiveRun | null>(null);
  runRef.current = run;

  // Cargar (o preparar) la carrera activa: sobrevive a recargas y cierres de la app.
  useEffect(() => {
    if (day === undefined) return;
    let cancel = false;
    void (async () => {
      let existing = await getActiveRun(db);
      const wantedDay = day?.planned.run ? day.id : null;
      const activity: CardioActivity = day?.planned.run?.activity ?? wantedAct ?? existing?.activity ?? 'run';
      // Una carrera preparada pero sin empezar se reemplaza si ahora se eligió otro día.
      if (existing && existing.stopwatch.status === 'idle' && existing.training_day_id !== wantedDay) {
        await discardRun(db);
        existing = undefined;
      }
      if (existing && existing.stopwatch.status === 'idle' && existing.activity !== activity) existing = await setRunActivity(db, existing, activity);
      const r =
        existing ??
        (await prepareRun(db, {
          activity,
          training_day_id: day?.planned.run ? day.id : null,
          run_type: day?.planned.run?.type ?? null,
          target_distance_km: day?.planned.run?.distance_km ?? null,
          target_duration_seconds: day?.planned.run ? day.planned.run.duration_min * 60 : null,
        }));
      const pts = await db.live_points.orderBy('seq').toArray();
      if (!cancel) {
        setRun(r);
        setPoints(pts);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [db, day, wantedAct]);

  // GPS: activo mientras la pantalla está abierta (para ver la señal antes de largar).
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGps({ kind: 'unavailable', message: 'Este navegador no permite usar el GPS.' });
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({ kind: 'ok', accuracy: Math.round(pos.coords.accuracy) });
        if (pos.coords.accuracy < 2000) rememberLocation(pos.coords.latitude, pos.coords.longitude);
        const r = runRef.current;
        if (!r) return;
        void addLivePoint(db, r, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }).then((p) => p && setPoints((ps) => [...ps, p]));
      },
      (err) => setGps(err.code === err.PERMISSION_DENIED ? { kind: 'denied' } : { kind: 'unavailable', message: 'No hay señal GPS. Probá al aire libre, lejos de edificios altos.' }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [db]);

  const running = run?.stopwatch.status === 'running';
  useWakeLock(!!run && run.stopwatch.status !== 'idle');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  const track = useMemo(() => accumulateTrack(points.map(toGps), maxSpeedFor(run?.activity)), [points, run?.activity]);
  const splits = useMemo(() => computeSplits(track), [track]);
  const elapsed = run ? elapsedMs(run.stopwatch, now) : 0;
  const pace = currentPace(track.accepted, track.cumulative_m);
  const avg = paceSecPerKm(track.distance_m / 1000, elapsed / 1000);

  // Aviso en cada kilómetro.
  const lastSplits = useRef(0);
  useEffect(() => {
    if (splits.length > lastSplits.current && lastSplits.current > 0) {
      if (settings.sound_enabled) beep();
      if (settings.vibration_enabled) navigator.vibrate?.([300, 120, 300]);
    }
    lastSplits.current = splits.length;
  }, [splits.length, settings.sound_enabled, settings.vibration_enabled]);

  if (!run || day === undefined) return <Spinner label="Preparando el GPS…" />;
  const act = run.activity ?? 'run';
  const speed = usesSpeed(act);
  const toKmh = (secPerKm: number | null) => (secPerKm ? 3600 / secPerKm : null);

  const target = run.target_distance_km;
  const progress = target ? Math.min(1, track.distance_m / 1000 / target) : null;
  const idle = run.stopwatch.status === 'idle';

  if (finishing) {
    return (
      <FinishRun
        noun={ACTIVITY_NOUN[act]}
        onBack={() => setFinishing(false)}
        onSave={async (rpe, notes) => {
          const id = await finishRun(ctx, run, { rpe, notes });
          navigate(`/running/${id}`, { replace: true });
        }}
        onDiscard={async () => {
          await discardRun(db);
          navigate('/running', { replace: true });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-2 pb-6">
      <div className="flex items-center justify-between">
        <Link to="/running" className="-ml-2 inline-flex min-h-11 items-center px-2 text-[14px] text-muted">
          {idle ? 'Cancelar' : 'Minimizar'}
        </Link>
        <GpsBadge gps={gps} />
      </div>

      {idle && !run.training_day_id ? (
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-raised p-1" role="radiogroup" aria-label="Actividad">
          {ACTIVITIES.map((a) => {
            const Icon = ACTIVITY_ICON[a];
            return (
              <button key={a} type="button" role="radio" aria-checked={act === a} onClick={() => void setRunActivity(db, run, a).then(setRun)} className={cx('inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-[14px] font-medium', act === a ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
                <Icon className="size-4" aria-hidden /> {ACTIVITY_LABEL[a]}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="inline-flex items-center gap-2 text-[15px] font-semibold">
          {(() => {
            const Icon = ACTIVITY_ICON[act];
            return <Icon className="size-4 text-accent" aria-hidden />;
          })()}
          {ACTIVITY_LABEL[act]}
        </p>
      )}

      {run.target_distance_km && (
        <p className="text-[14px] text-muted">
          Objetivo: <span className="font-semibold text-ink">{run.target_distance_km.toLocaleString('es-AR')} km</span>
          {run.target_duration_seconds ? ` · ~${Math.round(run.target_duration_seconds / 60)} min` : ''}
          {day?.planned.run?.intensity ? ` · ${day.planned.run.intensity}` : ''}
        </p>
      )}

      <section className="rounded-3xl border border-line bg-surface p-5 text-center">
        <p className="text-[13px] font-semibold tracking-wide text-muted uppercase">Distancia (km)</p>
        <p className="num text-[72px] leading-none font-bold" aria-live="off">
          {km(track.distance_m)}
        </p>
        {progress !== null && (
          <div className="mx-auto mt-3 h-2 max-w-[240px] overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance hacia el objetivo">
            <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Metric label="Tiempo" value={formatClock(elapsed)} />
          {speed ? (
            <>
              <Metric label="Velocidad" value={fmtSpeed(toKmh(pace))} unit=" km/h" />
              <Metric label="Promedio" value={fmtSpeed(toKmh(avg))} unit=" km/h" />
            </>
          ) : (
            <>
              <Metric label="Ritmo actual" value={formatPace(pace)} unit="/km" />
              <Metric label="Promedio" value={formatPace(avg)} unit="/km" />
            </>
          )}
        </div>
      </section>

      {gps.kind === 'denied' && (
        <ErrorBox>Sin permiso para usar tu ubicación. Activalo en los ajustes del navegador para este sitio, o registrala a mano.</ErrorBox>
      )}
      {gps.kind === 'unavailable' && <p className="rounded-2xl bg-warn/12 px-4 py-3 text-[14px] text-warn">{gps.message}</p>}
      {idle && (
        <p className="text-center text-[13px] text-muted">
          Mantené la app abierta y la pantalla encendida: en iPhone el GPS se detiene si la app pasa a segundo plano.
        </p>
      )}

      {/* Controles */}
      <div className="flex items-center justify-center gap-4">
        {idle ? (
          <button
            type="button"
            onClick={() => {
              primeAudio();
              void startRun(db, run).then(setRun);
            }}
            className="grid size-24 place-items-center rounded-full bg-accent text-accent-ink shadow-lg active:scale-95"
            aria-label={act === 'run' ? 'Empezar a correr' : act === 'walk' ? 'Empezar a caminar' : 'Empezar a pedalear'}
          >
            <Play className="size-10 fill-current" />
          </button>
        ) : running ? (
          <button type="button" onClick={() => void pauseRun(db, run).then(setRun)} className="grid size-24 place-items-center rounded-full bg-raised active:scale-95" aria-label="Pausar">
            <Pause className="size-10 fill-current" />
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void startRun(db, run).then(setRun)} className="grid size-20 place-items-center rounded-full bg-accent text-accent-ink active:scale-95" aria-label="Reanudar">
              <Play className="size-8 fill-current" />
            </button>
            <button type="button" onClick={() => setFinishing(true)} className="grid size-20 place-items-center rounded-full bg-danger text-bg active:scale-95" aria-label="Terminar">
              <Square className="size-7 fill-current" />
            </button>
          </>
        )}
      </div>
      {!idle && !running && <p className="text-center text-[13px] font-semibold text-warn">En pausa: no se suma distancia ni tiempo.</p>}
      {idle && <WeatherCard activity={act} compact showPrompt={false} />}

      {!idle && (
        <button type="button" onClick={() => setShowMap((v) => !v)} className="inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-full bg-raised px-4 text-[14px]">
          <MapIcon className="size-4" aria-hidden /> {showMap ? 'Ocultar mapa' : 'Ver mapa'}
        </button>
      )}
      {showMap && (
        <ErrorBoundary fallback={(retry) => <MapUnavailable retry={retry} />}>
          <Suspense fallback={<div className="h-64 rounded-3xl bg-raised" />}>
          <RouteMap points={track.accepted} follow />
        </Suspense>
        </ErrorBoundary>
      )}

      {splits.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">Parciales</h2>
          <ol className="flex flex-col gap-1.5">
            {[...splits].reverse().map((s) => (
              <li key={s.km} className="num flex items-center justify-between rounded-2xl bg-raised/70 px-4 py-2.5 text-[15px]">
                <span className="inline-flex items-center gap-2 text-muted">
                  <Flag className="size-3.5" aria-hidden /> Km {s.km}
                </span>
                <span className="font-semibold">{formatPace(s.duration_s)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-2xl bg-raised px-2 py-3">
      <div className="num text-[22px] leading-none font-bold">
        {value}
        {unit && value !== '—' && <span className="text-[12px] font-medium text-muted">{unit}</span>}
      </div>
      <div className="mt-1 text-[11px] text-muted">{label}</div>
    </div>
  );
}

function GpsBadge({ gps }: { gps: GpsState }) {
  const good = gps.kind === 'ok' && gps.accuracy <= 20;
  const fair = gps.kind === 'ok' && !good;
  return (
    <span role="status" className={cx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium', good ? 'bg-ok/15 text-ok' : fair ? 'bg-warn/12 text-warn' : 'bg-raised text-muted')}>
      {gps.kind === 'ok' ? <LocateFixed className="size-4" aria-hidden /> : <LocateOff className="size-4" aria-hidden />}
      {gps.kind === 'ok' ? `GPS ±${gps.accuracy} m` : gps.kind === 'waiting' ? 'Buscando GPS…' : 'Sin GPS'}
    </span>
  );
}

function FinishRun({ noun, onBack, onSave, onDiscard }: { noun: string; onBack: () => void; onSave: (rpe: number | null, notes: string) => Promise<void>; onDiscard: () => Promise<void> }) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooShort, setTooShort] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  return (
    <div className="flex flex-col gap-5 pt-2">
      <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-11 items-center self-start px-2 text-[14px] text-muted">
        Volver a la carrera
      </button>
      <h1 className="text-[26px] font-bold tracking-tight">¿Qué tan dura fue?</h1>
      <fieldset>
        <legend className="mb-2 text-[13px] text-muted">Esfuerzo percibido (1 = muy fácil, 10 = máximo)</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
            <button key={v} type="button" aria-pressed={rpe === v} onClick={() => setRpe(v)} className={cx('num min-h-12 rounded-xl text-[17px] font-bold', rpe === v ? 'bg-accent text-accent-ink' : 'border border-line bg-surface')}>
              {v}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-muted">Notas (opcional)</span>
        <textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} rows={3} className="rounded-xl border border-line bg-surface p-3 text-[16px] outline-none focus:border-accent" placeholder="Clima, sensaciones, recorrido…" />
      </label>
      {error && <ErrorBox>{error}</ErrorBox>}
      {tooShort && (
        <Link to="/running/manual" className="text-center text-[14px] underline underline-offset-4">
          Registrarla a mano
        </Link>
      )}
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onSave(rpe, notes);
          } catch (e) {
            setBusy(false);
            setTooShort(e instanceof RunTooShortError);
            setError(e instanceof Error ? e.message : 'No se pudo guardar.');
          }
        }}
      >
        Guardar {noun}
      </Button>
      {confirmDiscard ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
            Conservar
          </Button>
          <Button variant="danger" onClick={() => void onDiscard()}>
            <Trash2 className="size-4" aria-hidden /> Descartar
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmDiscard(true)} className="self-center py-2 text-[14px] text-danger">
          Descartar
        </button>
      )}
    </div>
  );
}

function MapUnavailable({ retry }: { retry: () => void }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-line p-4 text-center text-[14px] text-muted">
      El mapa no está disponible sin conexión. La distancia y el recorrido se siguen registrando.
      <button type="button" onClick={retry} className="text-ink underline underline-offset-4">
        Reintentar
      </button>
    </div>
  );
}
