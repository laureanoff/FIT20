import { useLiveQuery } from 'dexie-react-hooks';
import { MusicCard } from '@/features/music/MusicCard';
import { Check, ChevronLeft, ChevronRight, Minus, Pause, Play, Plus, SkipForward, Timer, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorBox, SectionTitle, Spinner, cx } from '@/components/ui';
import { useData } from '@/app/data';
import { formatClock, formatCountdown } from '@/core/timer/timer';
import { getExercise } from '@/data/exercises';
import { type ExerciseSet, type L, type WorkoutExercise, alive } from '@/lib/db/database';
import { type PastSet, abandonWorkout, finishWorkout, lastPerformance, logSet, removeSet } from './actions';
import { prescription, restLabel, targetFromReps } from './format';
import { useCtx } from './hooks';
import { primeAudio, useRestTimer, useWakeLock } from './useRestTimer';

const posKey = (id: string) => `fit20:session-pos:${id}`;

export function SessionScreen() {
  const { id } = useParams();
  const { db, settings } = useData();
  const ctx = useCtx();
  const navigate = useNavigate();

  const workout = useLiveQuery(async () => (id ? ((await db.workouts.get(id)) ?? null) : null), [db, id]);
  const exercises = useLiveQuery(async () => (id ? (await db.workout_exercises.where('workout_id').equals(id).toArray()).filter(alive).sort((a, b) => a.order_index - b.order_index) : []), [db, id]);
  const sets = useLiveQuery(async () => {
    if (!exercises?.length) return [] as L<ExerciseSet>[];
    return (await db.exercise_sets.where('workout_exercise_id').anyOf(exercises.map((e) => e.id)).toArray()).filter(alive);
  }, [db, exercises]);

  const [pos, setPos] = useState(() => Number(localStorage.getItem(posKey(id ?? '')) ?? 0) || 0);
  const [finishing, setFinishing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const rest = useRestTimer({ sound: settings.sound_enabled, vibration: settings.vibration_enabled });
  useWakeLock(workout?.status === 'started');

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(posKey(id ?? ''), String(pos));
    } catch {
      /* sin almacenamiento */
    }
  }, [id, pos]);

  if (workout === undefined || exercises === undefined || sets === undefined) return <Spinner />;
  if (!workout) return <p className="pt-6 text-muted">Entrenamiento no encontrado.</p>;
  if (workout.status !== 'started') {
    return (
      <div className="pt-6">
        <p className="text-muted">Este entrenamiento ya terminó.</p>
        <Link to={`/entrenar/historial/${workout.id}`} className="mt-3 inline-block underline">
          Ver resumen
        </Link>
      </div>
    );
  }

  const idx = Math.min(pos, Math.max(0, exercises.length - 1));
  const we = exercises[idx];
  const doneSets = (weId: string) => sets.filter((s) => s.workout_exercise_id === weId);
  const totalPlanned = exercises.reduce((a, e) => a + e.sets, 0);
  const totalDone = sets.length;
  const last = idx === exercises.length - 1;

  if (finishing) return <FinishSheet onBack={() => setFinishing(false)} onDone={async (rpe, notes) => {
    await finishWorkout(ctx, workout, rpe, notes);
    rest.stop();
    localStorage.removeItem(posKey(workout.id));
    navigate(`/entrenar/historial/${workout.id}`, { replace: true });
  }} />;

  return (
    <div className="flex flex-col gap-4 pt-2 pb-40">
      <div className="flex items-center justify-between">
        <AbandonButton
          onConfirm={async () => {
            await abandonWorkout(ctx, workout);
            rest.stop();
            navigate('/entrenar', { replace: true });
          }}
        />
        <span className="num inline-flex items-center gap-1.5 text-[14px] text-muted">
          <Timer className="size-4" aria-hidden /> {formatClock(now - Date.parse(workout.started_at))}
        </span>
      </div>

      <div>
        <p className="text-[13px] font-semibold text-muted uppercase">{workout.name}</p>
        <div className="mt-2 flex gap-1" aria-label={`Ejercicio ${idx + 1} de ${exercises.length}`}>
          {exercises.map((e, i) => (
            <button
              key={e.id}
              type="button"
              aria-label={`Ir al ejercicio ${i + 1}`}
              onClick={() => setPos(i)}
              className={cx('h-1.5 flex-1 rounded-full', doneSets(e.id).length >= e.sets ? 'bg-accent' : i === idx ? 'bg-ink' : 'bg-raised')}
            />
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted">
          {totalDone}/{totalPlanned} series
        </p>
      </div>

      {we && <ExerciseBlock key={we.id} we={we} sets={doneSets(we.id)} workoutId={workout.id} onSetLogged={(restS) => rest.start(restS)} />}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={idx === 0} onClick={() => setPos(idx - 1)}>
          <ChevronLeft className="size-4" aria-hidden /> Anterior
        </Button>
        {last ? (
          <Button onClick={() => setFinishing(true)}>
            <Check className="size-4" aria-hidden /> Terminar
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setPos(idx + 1)}>
            Siguiente <ChevronRight className="size-4" aria-hidden />
          </Button>
        )}
      </div>
      {!last && (
        <button type="button" onClick={() => setFinishing(true)} className="self-center py-2 text-[14px] text-muted underline underline-offset-4">
          Terminar ahora
        </button>
      )}

      <MusicCard />

      {rest.timer && (
        <div role="timer" aria-live="off" className="pb-safe fixed inset-x-0 bottom-16 z-30 mx-auto max-w-md px-3">
          <div className={cx('flex items-center gap-3 rounded-3xl p-3 shadow-2xl', rest.timer.status === 'done' ? 'bg-ok text-bg' : 'bg-raised')}>
            <div className="flex-1 pl-2">
              <p className="text-[12px] font-semibold uppercase opacity-70">{rest.timer.status === 'done' ? '¡A la próxima serie!' : 'Descanso'}</p>
              <p className="num text-[34px] leading-none font-bold">{formatCountdown(rest.left)}</p>
            </div>
            {rest.timer.status !== 'done' && (
              <>
                <button type="button" aria-label="Restar 15 segundos" onClick={() => rest.add(-15)} className="grid size-11 place-items-center rounded-full bg-surface">
                  <Minus className="size-4" />
                </button>
                <button type="button" aria-label="Sumar 15 segundos" onClick={() => rest.add(15)} className="grid size-11 place-items-center rounded-full bg-surface">
                  <Plus className="size-4" />
                </button>
                <button type="button" aria-label={rest.timer.status === 'paused' ? 'Reanudar' : 'Pausar'} onClick={rest.toggle} className="grid size-11 place-items-center rounded-full bg-surface">
                  {rest.timer.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}
                </button>
              </>
            )}
            <button type="button" aria-label="Cerrar descanso" onClick={rest.stop} className={cx('grid size-11 place-items-center rounded-full', rest.timer.status === 'done' ? 'bg-bg/20' : 'bg-accent text-accent-ink')}>
              {rest.timer.status === 'done' ? <X className="size-4" /> : <SkipForward className="size-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExerciseBlock({ we, sets, workoutId, onSetLogged }: { we: L<WorkoutExercise>; sets: L<ExerciseSet>[]; workoutId: string; onSetLogged: (restSeconds: number) => void }) {
  const ctx = useCtx();
  const ex = getExercise(we.exercise_id);
  const [past, setPast] = useState<PastSet | null | undefined>(undefined);
  useEffect(() => {
    void lastPerformance(ctx.db, we.exercise_id, workoutId).then(setPast);
  }, [ctx.db, we.exercise_id, workoutId]);

  const target = targetFromReps(we.repetitions);
  const timed = target.seconds !== null || !!ex?.timed;
  const loaded = !!ex && ex.equipment.some((e) => e !== 'bodyweight');
  const rows = Math.max(we.sets, ...sets.map((s) => s.set_number));
  const [extra, setExtra] = useState(0);
  const count = Math.min(20, rows + extra);
  const byNumber = new Map(sets.map((s) => [s.set_number, s]));

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-bold">{ex?.name ?? we.exercise_id}</h1>
          <p className="mt-1 text-[14px] text-muted">
            {prescription({ sets: we.sets, reps: we.repetitions })} · {restLabel(we.rest_seconds)}
          </p>
        </div>
        {ex && (
          <Link to={`/entrenar/ejercicio/${ex.id}`} className="shrink-0 rounded-full bg-raised px-3 py-1.5 text-[13px]">
            Técnica
          </Link>
        )}
      </div>
      {past && (
        <p className="mt-3 rounded-xl bg-raised px-3 py-2 text-[13px] text-muted">
          La vez pasada:{' '}
          {past.sets
            .map((s) => [s.kg ? `${s.kg.toLocaleString('es-AR')} kg` : null, s.reps !== null ? `${s.reps} rep` : s.seconds !== null ? `${s.seconds} s` : null].filter(Boolean).join(' × '))
            .join(' · ')}
        </p>
      )}
      {ex && ex.steps[0] && past === null && <p className="mt-3 text-[13px] text-muted">Primera vez: {ex.steps[0]}</p>}

      <SectionTitle>
        <span className="mt-5 block">Series</span>
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
          <SetRow
            key={n}
            n={n}
            done={byNumber.get(n)}
            timed={timed}
            loaded={loaded}
            defaults={{
              reps: byNumber.get(n - 1)?.repetitions_completed ?? target.reps,
              seconds: byNumber.get(n - 1)?.duration_seconds ?? target.seconds,
              kg: byNumber.get(n - 1)?.weight_kg ?? past?.sets[n - 1]?.kg ?? past?.sets.at(-1)?.kg ?? null,
            }}
            onSave={async (v) => {
              primeAudio();
              await logSet(ctx, we, n, v);
              if (we.rest_seconds > 0) onSetLogged(we.rest_seconds);
            }}
            onRemove={(s) => void removeSet(ctx, s)}
          />
        ))}
      </ul>
      {count < 20 && (
        <button type="button" onClick={() => setExtra((e) => e + 1)} className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-[14px] text-muted">
          <Plus className="size-4" aria-hidden /> Agregar serie
        </button>
      )}
    </Card>
  );
}

function numOrNull(s: string): number | null {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) ? n : null;
}

function SetRow({
  n,
  done,
  timed,
  loaded,
  defaults,
  onSave,
  onRemove,
}: {
  n: number;
  done: L<ExerciseSet> | undefined;
  timed: boolean;
  loaded: boolean;
  defaults: { reps: number | null; seconds: number | null; kg: number | null };
  onSave: (v: { repetitions_completed: number | null; duration_seconds: number | null; weight_kg: number | null }) => Promise<void>;
  onRemove: (s: L<ExerciseSet>) => void;
}) {
  const initial = done ? (timed ? done.duration_seconds : done.repetitions_completed) : timed ? defaults.seconds : defaults.reps;
  const [amount, setAmount] = useState(initial === null || initial === undefined ? '' : String(initial));
  const [kg, setKg] = useState(() => {
    const v = done ? done.weight_kg : defaults.kg;
    return v === null || v === undefined ? '' : String(v).replace('.', ',');
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  // Al registrar la serie anterior, la siguiente se precarga con esos valores (si no se editó).
  useEffect(() => {
    if (done || touched) return;
    const a = timed ? defaults.seconds : defaults.reps;
    setAmount(a === null || a === undefined ? '' : String(a));
    setKg(defaults.kg === null || defaults.kg === undefined ? '' : String(defaults.kg).replace('.', ','));
  }, [done, touched, timed, defaults.reps, defaults.seconds, defaults.kg]);
  const dirty = useMemo(() => {
    if (!done) return true;
    const a = numOrNull(amount);
    return a !== (timed ? done.duration_seconds : done.repetitions_completed) || numOrNull(kg) !== done.weight_kg;
  }, [done, amount, kg, timed]);

  async function save() {
    const a = numOrNull(amount);
    const w = numOrNull(kg);
    if (a === null || a < 0 || a > (timed ? 3600 : 500) || !Number.isInteger(a)) return setError(timed ? 'Segundos: 0 a 3600' : 'Repeticiones: 0 a 500');
    if (w !== null && (w < 0 || w > 500)) return setError('Peso: 0 a 500 kg');
    setError(null);
    setBusy(true);
    await onSave({ repetitions_completed: timed ? null : a, duration_seconds: timed ? a : null, weight_kg: w });
    setBusy(false);
  }

  const input = 'num h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-center text-[17px] font-semibold outline-none focus:border-accent';
  return (
    <li>
      <div className={cx('flex items-center gap-2 rounded-2xl p-2', done && !dirty ? 'bg-accent/12' : 'bg-raised/60')}>
        <span className="num w-7 text-center text-[15px] font-bold text-muted">{n}</span>
        <label className="flex-1">
          <span className="sr-only">{timed ? `Segundos serie ${n}` : `Repeticiones serie ${n}`}</span>
          <input className={input} inputMode="numeric" value={amount} onChange={(e) => {
              setTouched(true);
              setAmount(e.target.value.replace(/[^\d]/g, '').slice(0, 4));
            }} />
          <span className="mt-0.5 block text-center text-[11px] text-muted">{timed ? 'seg' : 'reps'}</span>
        </label>
        {loaded && (
          <label className="flex-1">
            <span className="sr-only">Kilos serie {n}</span>
            <input className={input} inputMode="decimal" placeholder="—" value={kg} onChange={(e) => {
              setTouched(true);
              setKg(e.target.value.replace(/[^\d,.]/g, '').slice(0, 6));
            }} />
            <span className="mt-0.5 block text-center text-[11px] text-muted">kg</span>
          </label>
        )}
        {done && !dirty ? (
          <button type="button" aria-label={`Borrar serie ${n}`} onClick={() => onRemove(done)} className="mb-4 grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink">
            <Check className="size-5" strokeWidth={3} />
          </button>
        ) : (
          <button type="button" aria-label={`Registrar serie ${n}`} disabled={busy} onClick={save} className="mb-4 grid size-12 shrink-0 place-items-center rounded-xl border-2 border-line text-muted">
            <Check className="size-5" />
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-[13px] text-danger">{error}</p>}
    </li>
  );
}

function AbandonButton({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-[13px] text-muted">¿Cancelar la sesión?</span>
        <button type="button" onClick={() => void onConfirm()} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-danger/15 px-3 text-[13px] font-semibold text-danger">
          <Trash2 className="size-3.5" aria-hidden /> Sí
        </button>
        <button type="button" onClick={() => setAsking(false)} className="min-h-9 rounded-full bg-raised px-3 text-[13px]">
          No
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setAsking(true)} className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[14px] text-muted">
      <X className="size-4" aria-hidden /> Cancelar
    </button>
  );
}

function FinishSheet({ onBack, onDone }: { onBack: () => void; onDone: (rpe: number | null, notes: string) => Promise<void> }) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-5 pt-2">
      <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start px-2 text-[14px] text-muted">
        <ChevronLeft className="size-4" aria-hidden /> Volver a la sesión
      </button>
      <h1 className="text-[26px] font-bold tracking-tight">¿Qué tan dura fue?</h1>
      <fieldset>
        <legend className="mb-2 text-[13px] text-muted">Esfuerzo percibido (1 = muy fácil, 10 = máximo)</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={rpe === v}
              onClick={() => setRpe(v)}
              className={cx('num min-h-12 rounded-xl text-[17px] font-bold', rpe === v ? 'bg-accent text-accent-ink' : v >= 9 ? 'border border-danger/40 bg-surface' : 'border border-line bg-surface')}
            >
              {v}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-muted">Notas (opcional)</span>
        <textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} rows={3} className="rounded-xl border border-line bg-surface p-3 text-[16px] outline-none focus:border-accent" placeholder="Cómo te sentiste, qué cambiarías…" />
      </label>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onDone(rpe, notes);
          } catch (e) {
            setBusy(false);
            setError(e instanceof Error ? e.message : 'No se pudo guardar.');
          }
        }}
      >
        <Check className="size-4" aria-hidden /> Guardar entrenamiento
      </Button>
    </div>
  );
}
