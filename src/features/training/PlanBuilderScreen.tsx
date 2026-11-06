import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Chip, ErrorBox, Field, SectionTitle, Toggle, cx } from '@/components/ui';
import { ACTIVITIES, ACTIVITY_ICON, ACTIVITY_LABEL } from '@/features/running/activity';
import { useProfile } from '@/app/data';
import { GOAL_LABELS, LEVEL_LABELS, WEEKDAYS } from '@/app/labels';
import { MAX_PLAN_DAYS, PLAN_PRESETS, generatePlan, validatePlanInput } from '@/core/planning/engine';
import { localToday } from '@/core/utils/date';
import { MUSCLE_LABELS } from '@/data/exercises';
import type { CardioActivity, MuscleGroup, PlannedDay } from '@/types/domain';
import { createPlan, planInputFrom } from './actions';
import { SESSION_LABELS, dateLabel } from './format';
import { useActivePlan, useCtx } from './hooks';
import { BackLink } from './LibraryScreens';
import { SessionIcon } from './TrainScreen';

const FOCUS: MuscleGroup[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'abs', 'quads', 'hamstrings', 'glutes', 'calves'];
const MAX_FOCUS = 3;

export function PlanBuilderScreen() {
  const profile = useProfile();
  const active = useActivePlan();
  const ctx = useCtx();
  const navigate = useNavigate();
  const [duration, setDuration] = useState<number>(30);
  const [custom, setCustom] = useState('');
  const [start, setStart] = useState(localToday());
  const [running, setRunning] = useState(true);
  // Por defecto: quien no corre arranca caminando; el resto, corriendo.
  const [cardio, setCardio] = useState<CardioActivity[]>(profile.running_experience === 'none' ? ['walk'] : ['run']);
  const [focus, setFocus] = useState<MuscleGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = custom ? Number(custom) : duration;
  const input = planInputFrom(profile, { duration_days: days, start_date: start, include_running: running, cardio, focus_muscles: focus });
  const problems = validatePlanInput(input);
  const preview = useMemo<PlannedDay[] | null>(() => {
    if (problems.length) return null;
    try {
      return generatePlan(input);
    } catch {
      return null;
    }
    // input se reconstruye en cada render: dependemos de sus partes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, start, running, cardio.join(), focus.join(), problems.length, profile]);

  const counts = preview?.reduce<Record<string, number>>((acc, d) => ((acc[d.session_type] = (acc[d.session_type] ?? 0) + 1), acc), {}) ?? {};

  async function create() {
    if (problems.length) return setError(problems.join(' '));
    setBusy(true);
    setError(null);
    try {
      await createPlan(ctx, input);
      navigate('/entrenar', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el plan.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/entrenar" label="Entrenar" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">Nuevo plan</h1>
        <p className="text-[14px] text-muted">
          Basado en tu perfil: {GOAL_LABELS[profile.primary_goal].title.toLowerCase()}, nivel {LEVEL_LABELS[profile.fitness_level].title.toLowerCase()},{' '}
          {WEEKDAYS.filter((d) => profile.training_weekdays.includes(d.value)).map((d) => d.short).join(' ')} · {profile.session_minutes} min.{' '}
          <Link to="/perfil" className="text-ink underline underline-offset-4">
            Cambiar
          </Link>
        </p>
      </div>

      <Card>
        <SectionTitle>Duración</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {PLAN_PRESETS.map((p) => (
            <Chip
              key={p}
              selected={!custom && duration === p}
              onClick={() => {
                setDuration(p);
                setCustom('');
              }}
            >
              {p} días
            </Chip>
          ))}
        </div>
        <Field className="mt-3" label="Otra duración" inputMode="numeric" suffix="días" placeholder={`1 a ${MAX_PLAN_DAYS}`} value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        <Field className="mt-3" label="Empieza el" type="date" value={start} min={localToday()} onChange={(e) => setStart(e.target.value)} />
      </Card>

      <Card>
        <Toggle
          label="Combinar con cardio"
          description={running ? 'Los días de fuerza terminan con un bloque de cardio y hay días solo de cardio. Progresa como máximo ~10% por semana.' : 'Solo fuerza y recuperación.'}
          checked={running}
          onChange={setRunning}
        />
        {running && (
          <>
            <h3 className="mt-4 mb-2 text-[13px] font-medium text-muted">¿Qué cardio querés hacer? (podés elegir varios)</h3>
            <div className="grid grid-cols-3 gap-2">
              {ACTIVITIES.map((a) => {
                const Icon = ACTIVITY_ICON[a];
                const on = cardio.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCardio((c) => (on ? (c.length > 1 ? c.filter((x) => x !== a) : c) : [...c, a]))}
                    className={cx('flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-[14px] font-medium', on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface')}
                  >
                    <Icon className="size-5" aria-hidden />
                    {ACTIVITY_LABEL[a]}
                  </button>
                );
              })}
            </div>
            {cardio.includes('run') && profile.running_experience === 'none' && <p className="mt-2 text-[13px] text-muted">Como todavía no corrés, el running arranca con trote y caminata.</p>}
          </>
        )}
        <h3 className="mt-4 mb-2 text-[13px] font-medium text-muted">Priorizar grupos musculares (opcional, hasta {MAX_FOCUS})</h3>
        <div className="flex flex-wrap gap-2">
          {FOCUS.map((m) => (
            <Chip
              key={m}
              selected={focus.includes(m)}
              onClick={() => setFocus((f) => (f.includes(m) ? f.filter((x) => x !== m) : f.length >= MAX_FOCUS ? f : [...f, m]))}
            >
              {MUSCLE_LABELS[m]}
            </Chip>
          ))}
        </div>
      </Card>

      {preview && (
        <Card>
          <SectionTitle>Vista previa</SectionTitle>
          <div className="flex flex-wrap gap-2 text-[13px]">
            {(['strength', 'strength_run', 'run', 'active_recovery', 'rest'] as const).map((t) =>
              counts[t] ? (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1.5">
                  <SessionIcon type={t} className="size-3.5 text-muted" />
                  {counts[t]} {SESSION_LABELS[t].toLowerCase()}
                </span>
              ) : null,
            )}
          </div>
          <h3 className="mt-4 mb-2 text-[13px] font-medium text-muted">Primera semana</h3>
          <ul className="flex flex-col divide-y divide-line">
            {preview.slice(0, 7).map((d) => (
              <li key={d.date} className="flex items-center gap-3 py-2.5">
                <SessionIcon type={d.session_type} className="size-4 shrink-0 text-muted" />
                <span className="w-24 shrink-0 text-[13px] text-muted">{dateLabel(d.date, { weekday: 'short', day: 'numeric' })}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{d.title}</span>
                {d.estimated_minutes > 0 && <span className="num text-[12px] text-muted">{d.estimated_minutes}′</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {active && <p className="rounded-2xl bg-warn/12 px-4 py-3 text-[14px] text-warn">Tu plan actual ({active.name}) se va a archivar. El historial de lo que entrenaste se conserva.</p>}
      {(error || (problems.length > 0 && custom)) && <ErrorBox>{error ?? problems.join(' ')}</ErrorBox>}

      <div className="pb-safe sticky bottom-20 z-10">
        <Button className="w-full shadow-lg" onClick={create} loading={busy} disabled={!preview}>
          Crear plan de {Number.isFinite(days) && days > 0 ? days : '…'} días
        </Button>
      </div>
    </div>
  );
}
