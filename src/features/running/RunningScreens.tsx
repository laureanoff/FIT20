import { useLiveQuery } from 'dexie-react-hooks';
import { WeatherCard } from '@/features/weather/WeatherCard';
import { ChevronRight, PenLine, Play, Trash2, Trophy } from 'lucide-react';
import { Suspense, lazy, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button, Card, ErrorBox, Field, SectionTitle, Spinner, cx } from '@/components/ui';
import { useData } from '@/app/data';
import { type RunSummary, formatPace, paceSecPerKm, personalBests, speedKmh, validateManualRun } from '@/core/running/track';
import type { CardioActivity } from '@/types/domain';
import { formatClock } from '@/core/timer/timer';
import { addDays, localToday, startOfWeek } from '@/core/utils/date';
import { type L, type RunningSession, alive } from '@/lib/db/database';
import { useCtx, useTodayDay } from '@/features/training/hooks';
import { dateLabel } from '@/features/training/format';
import { BackLink } from '@/features/training/LibraryScreens';
import { deleteRun, fromTrack, getActiveRun, saveManualRun, updateRunNotes } from './actions';
import { ACTIVITIES, ACTIVITY_ICON, ACTIVITY_LABEL, ACTIVITY_NOUN, ACTIVITY_VERB, activityOf, fmtSpeed, usesSpeed } from './activity';

const RouteMap = lazy(() => import('./RouteMap'));

const fmtKm = (n: number, d = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

function useRuns() {
  const { db } = useData();
  return useLiveQuery(async () => {
    const runs = (await db.running_sessions.toArray()).filter(alive).sort((a, b) => (b.session_date + (b.started_at ?? '')).localeCompare(a.session_date + (a.started_at ?? '')));
    const splits = (await db.running_splits.toArray()).filter(alive);
    const bySession = new Map<string, { km: number; duration_s: number }[]>();
    for (const s of splits) bySession.set(s.session_id, [...(bySession.get(s.session_id) ?? []), { km: s.kilometer, duration_s: s.duration_seconds }]);
    for (const v of bySession.values()) v.sort((a, b) => a.km - b.km);
    return { runs, bySession };
  }, [db]);
}

/** Totales de km por semana (lunes a domingo) de las últimas `weeks` semanas. */
export function weeklyKm(runs: readonly Pick<RunningSession, 'session_date' | 'distance_km'>[], today: string, weeks = 8): { week: string; km: number }[] {
  const monday = startOfWeek(today);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(monday, -7 * (weeks - 1 - i));
    const end = addDays(start, 6);
    const km = runs.filter((r) => r.session_date >= start && r.session_date <= end).reduce((a, r) => a + r.distance_km, 0);
    return { week: start, km: Math.round(km * 10) / 10 };
  });
}

type Filter = 'all' | CardioActivity;

export function RunningHome() {
  const data = useRuns();
  const today = useTodayDay();
  const { db } = useData();
  const active = useLiveQuery(async () => (await getActiveRun(db)) ?? null, [db]);
  const todayIso = localToday();
  const [filter, setFilter] = useState<Filter>('all');

  const stats = useMemo(() => {
    if (!data) return null;
    const runs = filter === 'all' ? data.runs : data.runs.filter((r) => activityOf(r) === filter);
    const summaries: RunSummary[] = runs.map((r) => ({ session_date: r.session_date, distance_km: r.distance_km, duration_seconds: r.duration_seconds, splits: data.bySession.get(r.id) }));
    const weeks = weeklyKm(runs, todayIso);
    const byActivity = ACTIVITIES.map((a) => {
      const rs = data.runs.filter((r) => activityOf(r) === a);
      return { a, n: rs.length, km: rs.reduce((acc, r) => acc + r.distance_km, 0) };
    }).filter((x) => x.n > 0);
    // En bici: mejor velocidad media en salidas de 10 km o más.
    const bestBike = runs.filter((r) => r.distance_km >= 10).reduce<number | null>((acc, r) => Math.max(acc ?? 0, speedKmh(r.distance_km, r.duration_seconds)), null);
    return { runs, pb: personalBests(summaries), weeks, thisWeek: weeks[weeks.length - 1]!.km, byActivity, bestBike };
  }, [data, todayIso, filter]);

  if (!data || !stats || active === undefined || today === undefined) return <Spinner />;
  const plannedRun = today?.planned.run && today.status !== 'completed' && today.status !== 'skipped' ? today : null;
  const plannedAct = plannedRun ? activityOf(plannedRun.planned.run) : 'run';
  const maxWeek = Math.max(1, ...stats.weeks.map((w) => w.km));
  const runningNow = active && active.stopwatch.status !== 'idle';

  return (
    <div className="flex flex-col gap-4 pt-3">
      <h1 className="text-[28px] font-bold tracking-tight">Cardio</h1>

      {runningNow ? (
        <Link to="/running/en-curso" className="flex items-center gap-3 rounded-3xl bg-accent p-5 text-accent-ink">
          <Play className="size-6 shrink-0 fill-current" aria-hidden />
          <span className="flex-1">
            <span className="block text-[13px] font-semibold uppercase opacity-70">
              {ACTIVITY_LABEL[activityOf(active)]} · {active.stopwatch.status === 'paused' ? 'en pausa' : 'en curso'}
            </span>
            <span className="block text-[17px] font-bold">Volver a la actividad</span>
          </span>
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      ) : (
        plannedRun && (
          <section className="rounded-3xl bg-accent p-5 text-accent-ink">
            <p className="text-[13px] font-semibold uppercase opacity-70">Hoy en tu plan</p>
            <p className="mt-1 text-[22px] leading-tight font-bold">{plannedRun.planned.title}</p>
            <p className="mt-1 text-[14px] opacity-75">
              {fmtKm(plannedRun.planned.run!.distance_km, 1)} km · ~{plannedRun.planned.run!.duration_min} min · {plannedRun.planned.run!.intensity}
            </p>
            <div className="mt-4 flex gap-2">
              <Link to={`/running/en-curso?dia=${plannedRun.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-accent-ink px-4 text-[14px] font-semibold text-accent">
                <Play className="size-4 fill-current" aria-hidden /> {ACTIVITY_VERB[plannedAct]} con GPS
              </Link>
              <Link to={`/running/manual?dia=${plannedRun.id}`} className="inline-flex min-h-11 items-center rounded-2xl bg-accent-ink/10 px-4 text-[14px] font-semibold">
                A mano
              </Link>
            </div>
          </section>
        )
      )}

      {!runningNow && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {ACTIVITIES.map((a) => {
              const Icon = ACTIVITY_ICON[a];
              return (
                <Link key={a} to={`/running/en-curso?actividad=${a}`} className={cx('flex flex-col gap-2 rounded-3xl p-4', plannedRun ? 'border border-line bg-surface' : 'bg-accent text-accent-ink')}>
                  <Icon className="size-6" aria-hidden />
                  <span className="text-[15px] leading-tight font-bold">{ACTIVITY_VERB[a]}</span>
                  <span className={cx('text-[12px]', plannedRun ? 'text-muted' : 'opacity-70')}>con GPS</span>
                </Link>
              );
            })}
          </div>
          <Link to="/running/manual" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-raised text-[15px] font-semibold">
            <PenLine className="size-4" aria-hidden /> Registrar a mano (cinta, bici fija, reloj)
          </Link>
          <WeatherCard activity={plannedAct} compact />
        </>
      )}

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]" role="radiogroup" aria-label="Filtrar por actividad">
        {(['all', ...ACTIVITIES] as Filter[]).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={cx('min-h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium', filter === f ? 'bg-ink text-bg' : 'bg-raised text-muted')}>
            {f === 'all' ? 'Todo' : ACTIVITY_LABEL[f]}
          </button>
        ))}
      </div>

      <Card>
        <SectionTitle>Esta semana</SectionTitle>
        <p className="flex items-baseline gap-2">
          <span className="num text-[36px] leading-none font-bold">{fmtKm(stats.thisWeek, 1)}</span>
          <span className="text-muted">km</span>
        </p>
        <div className="mt-4 flex h-24 items-end gap-1.5" role="img" aria-label={`Kilómetros por semana, últimas 8 semanas: ${stats.weeks.map((w) => w.km).join(', ')}`}>
          {stats.weeks.map((w, i) => (
            <div key={w.week} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className={cx('w-full rounded-md', i === stats.weeks.length - 1 ? 'bg-accent' : 'bg-raised')} style={{ height: `${Math.max(4, (w.km / maxWeek) * 100)}%` }} />
              <span className="num text-[10px] text-faint">{Number(w.week.slice(8))}</span>
            </div>
          ))}
        </div>
        {filter === 'all' && stats.byActivity.length > 1 && (
          <p className="mt-3 text-[13px] text-muted">
            En total: {stats.byActivity.map((x) => `${ACTIVITY_LABEL[x.a].toLowerCase()} ${fmtKm(x.km, 1)} km`).join(' · ')}
          </p>
        )}
      </Card>

      {stats.runs.length > 0 && filter !== 'all' && (
        <Card>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="size-3.5" aria-hidden /> Marcas · {ACTIVITY_LABEL[filter]}
            </span>
          </SectionTitle>
          <dl className="grid grid-cols-2 gap-2">
            <Pb label="Más larga" value={stats.pb.longest_km !== null ? `${fmtKm(stats.pb.longest_km)} km` : '—'} />
            {filter === 'bike' ? (
              <Pb label="Mejor velocidad (10 km+)" value={stats.bestBike ? `${fmtSpeed(stats.bestBike)} km/h` : '—'} />
            ) : (
              <Pb label="Mejor ritmo (3 km+)" value={stats.pb.fastest_pace_3k_plus !== null ? `${formatPace(stats.pb.fastest_pace_3k_plus)}/km` : '—'} />
            )}
            {filter === 'run' && <Pb label="Mejor km" value={stats.pb.best_1k_s !== null ? formatClock(stats.pb.best_1k_s * 1000) : '—'} />}
            {filter === 'run' && <Pb label="Mejor 5 km" value={stats.pb.best_5k_s !== null ? formatClock(stats.pb.best_5k_s * 1000) : '—'} />}
          </dl>
          <p className="mt-3 text-[13px] text-muted">
            Total: {fmtKm(stats.pb.total_km, 1)} km en {stats.runs.length} {stats.runs.length === 1 ? 'salida' : 'salidas'} · {formatClock(stats.pb.total_seconds * 1000)}
          </p>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">Historial</h2>
        {stats.runs.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line p-6 text-center text-[14px] text-muted">Tus salidas aparecen acá, con sus parciales y el recorrido.</p>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {stats.runs.map((r) => {
                const a = activityOf(r);
                const Icon = ACTIVITY_ICON[a];
                return (
                  <li key={r.id}>
                    <Link to={`/running/${r.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-raised text-muted" title={ACTIVITY_LABEL[a]}>
                        <Icon className="size-4" aria-label={ACTIVITY_LABEL[a]} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="num block text-[15px] font-semibold">
                          {fmtKm(r.distance_km)} km · {formatClock(r.duration_seconds * 1000)}
                        </span>
                        <span className="block text-[13px] text-muted">
                          {dateLabel(r.session_date, { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
                          {usesSpeed(a) ? `${fmtSpeed(speedKmh(r.distance_km, r.duration_seconds))} km/h` : `${formatPace(paceSecPerKm(r.distance_km, r.duration_seconds))}/km`}
                          {r.source === 'gps' ? ' · GPS' : ''}
                        </span>
                      </span>
                      <ChevronRight className="size-4 text-faint" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function Pb({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-raised p-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[18px] font-semibold">{value}</dd>
    </div>
  );
}

export function ManualRunScreen() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const { db } = useData();
  const [params] = useSearchParams();
  const dayId = params.get('dia');
  const day = useLiveQuery(async () => (dayId ? ((await db.training_days.get(dayId)) ?? null) : null), [db, dayId]);
  const [chosen, setChosen] = useState<CardioActivity | null>(null);
  const act: CardioActivity = chosen ?? activityOf(day?.planned.run) ?? 'run';
  const [date, setDate] = useState(localToday());
  const [distance, setDistance] = useState('');
  const [time, setTime] = useState('');
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const dist = Number(distance.replace(',', '.'));
  const check = distance && time ? validateManualRun({ distance_km: dist, duration: time }, act) : null;

  async function save() {
    const v = validateManualRun({ distance_km: dist, duration: time }, act);
    if (!v.ok) return setErrors(v.errors);
    if (date > localToday()) return setErrors(['La fecha no puede ser futura.']);
    setBusy(true);
    const run = day?.planned.run;
    const id = await saveManualRun(ctx, {
      session_date: date,
      distance_km: dist,
      duration_seconds: v.duration_s,
      rpe,
      notes,
      target: {
        activity: act,
        training_day_id: run ? day!.id : null,
        run_type: run?.type ?? null,
        target_distance_km: run?.distance_km ?? null,
        target_duration_seconds: run ? run.duration_min * 60 : null,
      },
    });
    navigate(`/running/${id}`, { replace: true });
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/running" label="Cardio" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">Registrar a mano</h1>
        {day?.planned.run && <p className="text-[14px] text-muted">Para tu plan: {day.planned.title} ({fmtKm(day.planned.run.distance_km, 1)} km)</p>}
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-raised p-1" role="radiogroup" aria-label="Actividad">
        {ACTIVITIES.map((a) => {
          const Icon = ACTIVITY_ICON[a];
          return (
            <button key={a} type="button" role="radio" aria-checked={act === a} onClick={() => setChosen(a)} className={cx('inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-[14px] font-medium', act === a ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
              <Icon className="size-4" aria-hidden /> {ACTIVITY_LABEL[a]}
            </button>
          );
        })}
      </div>
      <Field label="Fecha" type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Distancia" inputMode="decimal" suffix="km" placeholder="5,2" value={distance} onChange={(e) => setDistance(e.target.value.replace(/[^\d,.]/g, ''))} />
        <Field label="Tiempo" inputMode="numeric" placeholder="28:30" hint="mm:ss o h:mm:ss" value={time} onChange={(e) => setTime(e.target.value.replace(/[^\d:]/g, ''))} />
      </div>
      {check?.ok && (
        <p className="num rounded-2xl bg-raised px-4 py-3 text-[15px]">
          {usesSpeed(act) ? (
            <>
              Velocidad media: <strong>{fmtSpeed(3600 / check.pace)} km/h</strong>
            </>
          ) : (
            <>
              Ritmo: <strong>{formatPace(check.pace)}/km</strong>
            </>
          )}
        </p>
      )}
      <fieldset>
        <legend className="mb-2 text-[13px] text-muted">Esfuerzo (opcional, 1–10)</legend>
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
            <button key={v} type="button" aria-pressed={rpe === v} onClick={() => setRpe(rpe === v ? null : v)} className={cx('num min-h-11 rounded-lg text-[15px] font-bold', rpe === v ? 'bg-accent text-accent-ink' : 'border border-line bg-surface')}>
              {v}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-muted">Notas (opcional)</span>
        <textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} rows={2} className="rounded-xl border border-line bg-surface p-3 text-[16px] outline-none focus:border-accent" />
      </label>
      {errors.length > 0 && <ErrorBox>{errors.join(' ')}</ErrorBox>}
      <Button onClick={save} loading={busy} disabled={!distance || !time}>
        Guardar
      </Button>
    </div>
  );
}

export function RunDetailScreen() {
  const { id } = useParams();
  const { db } = useData();
  const ctx = useCtx();
  const navigate = useNavigate();
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const run = await db.running_sessions.get(id);
    if (!alive(run)) return null;
    const splits = (await db.running_splits.where('session_id').equals(id).toArray()).filter(alive).sort((a, b) => a.kilometer - b.kilometer);
    const track = (await db.running_tracks.where('session_id').equals(id).toArray()).find(alive) ?? null;
    return { run, splits, track };
  }, [db, id]);
  const [confirm, setConfirm] = useState(false);

  if (data === undefined) return <Spinner />;
  if (!data) return <p className="pt-6 text-muted">Actividad no encontrada.</p>;
  const { run, splits, track } = data;
  const act = activityOf(run);
  const ActIcon = ACTIVITY_ICON[act];
  const pace = paceSecPerKm(run.distance_km, run.duration_seconds);
  const fastest = splits.length ? Math.min(...splits.map((s) => s.duration_seconds)) : 0;
  const slowest = splits.length ? Math.max(...splits.map((s) => s.duration_seconds)) : 0;
  const mapPoints = track ? track.points.map(fromTrack) : [];

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/running" label="Cardio" />
        <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted uppercase">
          <ActIcon className="size-3.5" aria-hidden /> {ACTIVITY_LABEL[act]} · {dateLabel(run.session_date)}
          {run.started_at ? ` · ${new Date(run.started_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>
        <h1 className="num text-[40px] leading-none font-bold">{fmtKm(run.distance_km)} km</h1>
        <p className="mt-1 text-[14px] text-muted">{run.source === 'gps' ? 'Registrada con GPS' : 'Registrada a mano'}</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Pb label="Tiempo" value={formatClock(run.duration_seconds * 1000)} />
        <Pb label={usesSpeed(act) ? 'Velocidad' : 'Ritmo'} value={usesSpeed(act) ? `${fmtSpeed(speedKmh(run.distance_km, run.duration_seconds))} km/h` : `${formatPace(pace)}/km`} />
        <Pb label={usesSpeed(act) ? 'Ritmo' : 'Velocidad'} value={usesSpeed(act) ? `${formatPace(pace)}/km` : `${fmtSpeed(speedKmh(run.distance_km, run.duration_seconds))} km/h`} />
      </div>

      {run.target_distance_km && (
        <p className="rounded-2xl bg-raised px-4 py-3 text-[14px]">
          Objetivo del plan: {fmtKm(run.target_distance_km, 1)} km{' '}
          {run.distance_km >= run.target_distance_km * 0.95 ? <span className="font-semibold text-ok">· cumplido</span> : <span className="text-muted">· {Math.round((run.distance_km / run.target_distance_km) * 100)}%</span>}
        </p>
      )}

      {mapPoints.length > 1 && (
        <ErrorBoundary fallback={(retry) => <MapUnavailable retry={retry} />}>
          <Suspense fallback={<div className="h-64 rounded-3xl bg-raised" />}>
          <RouteMap points={mapPoints} />
        </Suspense>
        </ErrorBoundary>
      )}

      {splits.length > 0 && (
        <Card>
          <SectionTitle>Parciales por km</SectionTitle>
          <ol className="flex flex-col gap-2">
            {splits.map((s) => (
              <li key={s.id} className="num flex items-center gap-3 text-[14px]">
                <span className="w-10 text-muted">Km {s.kilometer}</span>
                <span className="h-3 flex-1 overflow-hidden rounded-full bg-raised">
                  <span
                    className={cx('block h-full rounded-full', s.duration_seconds === fastest && splits.length > 1 ? 'bg-accent' : 'bg-muted/50')}
                    style={{ width: `${slowest ? Math.max(25, (fastest / s.duration_seconds) * 100) : 100}%` }}
                  />
                </span>
                <span className="w-12 text-right font-semibold">{formatPace(s.duration_seconds)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12px] text-muted">El km más rápido está resaltado.</p>
        </Card>
      )}

      <NotesEditor run={run} />

      {confirm ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await deleteRun(ctx, run);
              navigate('/running', { replace: true });
            }}
          >
            <Trash2 className="size-4" aria-hidden /> Eliminar
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="self-center py-2 text-[14px] text-danger">
          Eliminar {ACTIVITY_NOUN[act]}
        </button>
      )}
    </div>
  );
}

function NotesEditor({ run }: { run: L<RunningSession> }) {
  const ctx = useCtx();
  const [rpe, setRpe] = useState<number | null>(run.rpe);
  const [notes, setNotes] = useState(run.notes ?? '');
  const [saved, setSaved] = useState(false);
  const dirty = rpe !== run.rpe || (notes.trim() || null) !== run.notes;
  return (
    <Card>
      <SectionTitle>Sensaciones</SectionTitle>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={rpe === v}
            aria-label={`Esfuerzo ${v}`}
            onClick={() => {
              setRpe(rpe === v ? null : v);
              setSaved(false);
            }}
            className={cx('num min-h-10 rounded-lg text-[14px] font-bold', rpe === v ? 'bg-accent text-accent-ink' : 'bg-raised')}
          >
            {v}
          </button>
        ))}
      </div>
      <textarea
        value={notes}
        maxLength={2000}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={2}
        placeholder="Notas"
        aria-label="Notas"
        className="mt-3 w-full rounded-xl border border-line bg-surface p-3 text-[16px] outline-none focus:border-accent"
      />
      {(dirty || saved) && (
        <Button
          variant="secondary"
          className="mt-3 w-full"
          disabled={!dirty}
          onClick={async () => {
            await updateRunNotes(ctx, run, { rpe, notes });
            setSaved(true);
          }}
        >
          {saved && !dirty ? 'Guardado' : 'Guardar'}
        </Button>
      )}
    </Card>
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
