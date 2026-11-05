import { ArrowLeftRight, CalendarClock, Check, Footprints, Info, Play, ShieldAlert, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Chip, ErrorBox, SectionTitle, Spinner, cx } from '@/components/ui';
import { INJURY_LABELS } from '@/app/labels';
import { alternativesFor } from '@/core/planning/engine';
import { localToday } from '@/core/utils/date';
import { getExercise } from '@/data/exercises';
import type { L, TrainingDay, TrainingPlan } from '@/lib/db/database';
import type { BodyRegion } from '@/types/domain';
import { applyReadiness, completeDay, moveDay, skipDay, startWorkout, swapDayExercise } from './actions';
import { SESSION_LABELS, STATUS_LABELS, dateLabel, prescription, restLabel } from './format';
import { useCtx, useDay, usePlanDays } from './hooks';
import { BackLink, ExerciseRow } from './LibraryScreens';
import { useLiveQuery } from 'dexie-react-hooks';
import { useData } from '@/app/data';

export function DayScreen() {
  const { id } = useParams();
  const day = useDay(id);
  const { db } = useData();
  const plan = useLiveQuery(async () => (day ? ((await db.training_plans.get(day.plan_id)) ?? null) : undefined), [db, day?.plan_id]);
  const days = usePlanDays(day?.plan_id);
  const [mode, setMode] = useState<'view' | 'check'>('view');

  if (day === undefined || plan === undefined || days === undefined) return <Spinner />;
  if (!day || !plan) return <p className="pt-6 text-muted">Este día ya no existe.</p>;
  if (mode === 'check') return <ReadinessCheck day={day} plan={plan} onCancel={() => setMode('view')} />;
  return <DayView day={day} plan={plan} days={days} onStart={() => setMode('check')} />;
}

function DayView({ day, plan, days, onStart }: { day: L<TrainingDay>; plan: L<TrainingPlan>; days: L<TrainingDay>[]; onStart: () => void }) {
  const ctx = useCtx();
  const p = day.planned;
  const today = localToday();
  const [swapping, setSwapping] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = day.status === 'pending' && day.date >= today;
  const hasExercises = p.exercises.length > 0;
  const restTargets = days.filter((d) => d.session_type === 'rest' && d.date >= today && d.id !== day.id && Math.abs(d.day_number - day.day_number) <= 7);
  const future = day.date > today;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/entrenar" label="Plan" />
        <p className="mt-1 text-[13px] font-semibold text-muted uppercase">
          {dateLabel(day.date)} · Día {day.day_number}
        </p>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">{p.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
          <span className="rounded-full bg-raised px-2.5 py-1">{SESSION_LABELS[day.session_type]}</span>
          {p.estimated_minutes > 0 && <span className="rounded-full bg-raised px-2.5 py-1">~{p.estimated_minutes} min</span>}
          {p.is_deload && <span className="rounded-full bg-raised px-2.5 py-1">Semana de descarga</span>}
          <span className={cx('rounded-full px-2.5 py-1', day.status === 'completed' ? 'bg-ok/15 text-ok' : day.status === 'skipped' ? 'bg-raised text-faint' : 'border border-line')}>{STATUS_LABELS[day.status]}</span>
        </div>
        {day.session_type !== 'rest' && <p className="mt-3 text-[14px] text-muted">{p.intensity}</p>}
      </div>

      {day.readiness && (day.readiness.changes.length > 0 || day.readiness.warnings.length > 0) && (
        <Card className="border-warn/40">
          <SectionTitle>Ajustes de hoy</SectionTitle>
          <ul className="flex flex-col gap-2 text-[14px]">
            {day.readiness.changes.map((c) => (
              <li key={c} className="flex gap-2">
                <ArrowLeftRight className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                {c}
              </li>
            ))}
            {day.readiness.warnings.map((w) => (
              <li key={w} className="flex gap-2 text-warn">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {hasExercises && (
        <Card className="p-0">
          <h2 className="px-5 pt-4 text-[13px] font-semibold tracking-wide text-muted uppercase">Ejercicios</h2>
          <ul className="divide-y divide-line">
            {p.exercises.map((pe, i) => {
              const ex = getExercise(pe.exercise_id);
              if (!ex) return null;
              return (
                <li key={`${pe.exercise_id}-${i}`}>
                  <ExerciseRow
                    ex={ex}
                    to={`/entrenar/ejercicio/${ex.id}`}
                    sub={`${prescription(pe)} · ${restLabel(pe.rest_seconds)}${pe.notes ? ' · ver nota' : ''}`}
                    right={
                      editable ? (
                        <button
                          type="button"
                          aria-label={`Cambiar ${ex.name}`}
                          onClick={(e) => {
                            e.preventDefault();
                            setSwapping(swapping === i ? null : i);
                          }}
                          className="grid size-9 place-items-center rounded-full bg-raised text-muted"
                        >
                          <ArrowLeftRight className="size-4" />
                        </button>
                      ) : undefined
                    }
                  />
                  {pe.notes && <p className="-mt-1 flex gap-2 px-5 pb-3 text-[13px] text-muted"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{pe.notes}</p>}
                  {swapping === i && <SwapPicker exerciseId={ex.id} plan={plan} onPick={(alt) => void swapDayExercise(ctx, day, i, alt).then(() => setSwapping(null))} />}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {p.run && (
        <Card>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              <Footprints className="size-3.5" aria-hidden /> Carrera
            </span>
          </SectionTitle>
          <p className="flex items-baseline gap-3">
            <span className="num text-[30px] font-bold">{p.run.distance_km.toLocaleString('es-AR')} km</span>
            <span className="text-muted">~{p.run.duration_min} min</span>
          </p>
          <p className="mt-1 text-[14px] text-muted">{p.run.intensity}</p>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[14px]">
            {p.run.instructions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <SectionTitle>Indicaciones</SectionTitle>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px]">
          {p.instructions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Card>

      {moving && (
        <Card>
          <SectionTitle>Mover a un día de descanso</SectionTitle>
          {restTargets.length ? (
            <div className="flex flex-wrap gap-2">
              {restTargets.map((t) => (
                <Chip
                  key={t.id}
                  selected={false}
                  onClick={() =>
                    void moveDay(ctx, days, day, t.date)
                      .then(() => setMoving(false))
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  {dateLabel(t.date, { weekday: 'short', day: 'numeric' })}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-[14px] text-muted">No hay días de descanso cercanos. Para no acumular carga, las sesiones no se apilan.</p>
          )}
        </Card>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}

      {day.session_type !== 'rest' && (
        <div className="flex flex-col gap-2">
          {day.status === 'pending' && hasExercises && !future && (
            <Button onClick={onStart}>
              <Play className="size-4 fill-current" aria-hidden /> Empezar sesión
            </Button>
          )}
          {day.status === 'started' && <ResumeButton day={day} />}
          {day.status === 'pending' && !hasExercises && !future && (
            <Button variant={p.run ? 'secondary' : 'primary'} onClick={() => void completeDay(ctx, day, true)}>
              <Check className="size-4" aria-hidden /> Marcar como hecho
            </Button>
          )}
          {day.status !== 'completed' && day.status !== 'skipped' && p.run && !future && (
            <div className="grid grid-cols-2 gap-2">
              <Link to={`/running/en-curso?dia=${day.id}`} className={cx('inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold', hasExercises ? 'bg-raised' : 'bg-accent text-accent-ink')}>
                <Footprints className="size-4" aria-hidden /> Correr con GPS
              </Link>
              <Link to={`/running/manual?dia=${day.id}`} className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-raised text-[15px] font-semibold">
                Registrar a mano
              </Link>
            </div>
          )}
          {day.status === 'completed' && !hasExercises && (
            <Button variant="secondary" onClick={() => void completeDay(ctx, day, false)}>
              <Undo2 className="size-4" aria-hidden /> Desmarcar
            </Button>
          )}
          {editable && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setMoving((m) => !m)}>
                <CalendarClock className="size-4" aria-hidden /> Mover
              </Button>
              <Button variant="secondary" onClick={() => void skipDay(ctx, day, true)}>
                <X className="size-4" aria-hidden /> Saltear
              </Button>
            </div>
          )}
          {day.status === 'skipped' && (
            <Button variant="secondary" onClick={() => void skipDay(ctx, day, false)}>
              <Undo2 className="size-4" aria-hidden /> Volver a pendiente
            </Button>
          )}
          {future && day.status === 'pending' && <p className="text-center text-[13px] text-muted">Podrás empezarla ese día.</p>}
        </div>
      )}
    </div>
  );
}

function ResumeButton({ day }: { day: L<TrainingDay> }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  return (
    <Button onClick={() => void startWorkout(ctx, day).then((id) => navigate(`/entrenar/sesion/${id}`))}>
      <Play className="size-4 fill-current" aria-hidden /> Retomar sesión
    </Button>
  );
}

function SwapPicker({ exerciseId, plan, onPick }: { exerciseId: string; plan: L<TrainingPlan>; onPick: (id: string) => void }) {
  const alts = alternativesFor(exerciseId, plan.input).slice(0, 6);
  return (
    <div className="mx-4 mb-3 rounded-2xl bg-raised p-3">
      <p className="mb-2 text-[13px] text-muted">Alternativas con el mismo movimiento, tu equipo y sin zonas a cuidar:</p>
      {alts.length ? (
        <div className="flex flex-col gap-1.5">
          {alts.map((a) => (
            <button key={a.id} type="button" onClick={() => onPick(a.id)} className="flex min-h-11 items-center justify-between rounded-xl bg-surface px-3 text-left text-[14px]">
              {a.name}
              <span className="text-[12px] text-muted">{['Fácil', 'Media', 'Exigente'][a.difficulty - 1]}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[14px]">No hay alternativas disponibles para este ejercicio.</p>
      )}
    </div>
  );
}

const FATIGUE = [
  { v: 1, label: 'Descansado/a' },
  { v: 2, label: 'Bien' },
  { v: 3, label: 'Normal' },
  { v: 4, label: 'Cansado/a' },
  { v: 5, label: 'Agotado/a' },
] as const;

function ReadinessCheck({ day, plan, onCancel }: { day: L<TrainingDay>; plan: L<TrainingPlan>; onCancel: () => void }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [fatigue, setFatigue] = useState<1 | 2 | 3 | 4 | 5>(2);
  const [pain, setPain] = useState<BodyRegion[]>([]);
  const [result, setResult] = useState<{ changes: string[]; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    const r = await applyReadiness(ctx, day, plan, { fatigue, pain_regions: pain });
    setBusy(false);
    if (!r.changes.length && !r.warnings.length) return go();
    setResult(r);
  }

  async function go() {
    setBusy(true);
    const fresh = (await ctx.db.training_days.get(day.id)) ?? day;
    if (!fresh.planned.exercises.length) {
      setBusy(false);
      navigate(`/entrenar/dia/${day.id}`);
      onCancel();
      return;
    }
    const id = await startWorkout(ctx, fresh);
    navigate(`/entrenar/sesion/${id}`);
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div>
        <button type="button" onClick={onCancel} className="-ml-2 inline-flex min-h-11 items-center px-2 text-[14px] text-muted">
          Cancelar
        </button>
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">¿Cómo llegás hoy?</h1>
        <p className="text-[14px] text-muted">Ajustamos la sesión a cómo te sentís. Solo puede bajar la carga, nunca subirla.</p>
      </div>

      {result ? (
        <>
          <Card>
            <SectionTitle>Ajustamos tu sesión</SectionTitle>
            <ul className="flex flex-col gap-2 text-[14px]">
              {result.changes.map((c) => (
                <li key={c} className="flex gap-2">
                  <ArrowLeftRight className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  {c}
                </li>
              ))}
              {result.warnings.map((w) => (
                <li key={w} className="flex gap-2 text-warn">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
          </Card>
          <Button onClick={go} loading={busy}>
            <Play className="size-4 fill-current" aria-hidden /> Empezar
          </Button>
          <Link to={`/entrenar/dia/${day.id}`} onClick={onCancel} className="self-center text-[14px] text-muted underline underline-offset-4">
            Ver la sesión ajustada
          </Link>
        </>
      ) : (
        <>
          <fieldset>
            <legend className="mb-2.5 text-[13px] font-medium text-muted">Energía / fatiga</legend>
            <div className="grid grid-cols-5 gap-1.5" role="radiogroup">
              {FATIGUE.map((f) => (
                <button
                  key={f.v}
                  type="button"
                  role="radio"
                  aria-checked={fatigue === f.v}
                  onClick={() => setFatigue(f.v)}
                  className={cx('flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] leading-tight', fatigue === f.v ? 'bg-accent text-accent-ink' : 'border border-line bg-surface text-muted')}
                >
                  <span className="num text-[18px] font-bold">{f.v}</span>
                  {f.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2.5 text-[13px] font-medium text-muted">¿Sentís dolor en alguna zona? (no el cansancio muscular normal)</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(INJURY_LABELS) as BodyRegion[]).map((r) => (
                <Chip key={r} selected={pain.includes(r)} onClick={() => setPain((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))}>
                  {INJURY_LABELS[r]}
                </Chip>
              ))}
            </div>
          </fieldset>
          <Button onClick={check} loading={busy}>
            Continuar
          </Button>
        </>
      )}
    </div>
  );
}
