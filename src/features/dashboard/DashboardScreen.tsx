import { ArrowRight, BedDouble, Dumbbell, Droplets, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, SectionTitle, cx } from '@/components/ui';
import { useProfile } from '@/app/data';
import { GOAL_LABELS, WEEKDAYS } from '@/app/labels';
import { bmi } from '@/core/nutrition/energy';
import { addDays, localToday, startOfWeek, weekday } from '@/core/utils/date';
import { energyFor } from '@/features/profile/energy';
import { useOpenWorkout, useTodayDay } from '@/features/training/hooks';
import { SESSION_LABELS } from '@/features/training/format';
import { useDayLog, useTargets } from '@/features/nutrition/hooks';

const kg = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kg`;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function greeting(hour: number): string {
  if (hour >= 5 && hour < 13) return 'Buen día';
  if (hour >= 13 && hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export function DashboardScreen() {
  const profile = useProfile();
  const today = localToday();
  const now = new Date();
  const firstName = profile.full_name.split(/\s+/)[0];
  const trainsToday = profile.training_weekdays.includes(weekday(today));
  const energy = energyFor(profile, today);
  const monday = startOfWeek(today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div>
        <p className="text-[14px] text-muted">{capitalize(now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
        <h1 className="mt-0.5 text-[28px] leading-tight font-bold tracking-tight">
          {greeting(now.getHours())}, {firstName}
        </h1>
      </div>

      {/* Hoy */}
      <TodayHero trainsToday={trainsToday} sessionMinutes={profile.session_minutes} />

      {/* Semana */}
      <Card>
        <SectionTitle>Tu semana</SectionTitle>
        <ol className="grid grid-cols-7 gap-1.5">
          {week.map((date) => {
            const wd = weekday(date);
            const label = WEEKDAYS.find((d) => d.value === wd)!;
            const training = profile.training_weekdays.includes(wd);
            const isToday = date === today;
            return (
              <li key={date} className="flex flex-col items-center gap-1.5">
                <span className={cx('text-[11px] font-medium', isToday ? 'text-ink' : 'text-faint')}>{label.short}</span>
                <span
                  aria-label={`${label.long}: ${training ? 'entrenamiento' : 'descanso'}${isToday ? ' (hoy)' : ''}`}
                  className={cx(
                    'num grid aspect-square w-full place-items-center rounded-xl text-[14px] font-semibold',
                    training ? 'bg-accent/15 text-ink' : 'bg-raised text-faint',
                    isToday && 'ring-2 ring-accent',
                  )}
                >
                  {Number(date.slice(8))}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[13px] text-muted">
          {profile.training_weekdays.length} días de entrenamiento · {profile.session_minutes} min por sesión
        </p>
      </Card>

      {/* Nutrición de hoy */}
      <TodayNutrition missing={energy.status === 'ok' ? null : energy.missing} />

      {/* Peso y objetivo */}
      <Card>
        <SectionTitle>
          <span className="inline-flex items-center gap-1.5">
            <Target className="size-3.5" aria-hidden /> {GOAL_LABELS[profile.primary_goal].title}
          </span>
        </SectionTitle>
        <WeightGoal current={profile.current_weight_kg} target={profile.target_weight_kg} height={profile.height_cm} />
      </Card>
    </div>
  );
}

function WeightGoal({ current, target, height }: { current: number; target: number | null; height: number }) {
  const b = bmi(current, height);
  const diff = target !== null ? Math.round((target - current) * 10) / 10 : null;
  return (
    <div className="grid grid-cols-3 gap-2">
      <Stat label="Peso actual" value={kg(current)} />
      <Stat label="Objetivo" value={target !== null ? kg(target) : '—'} />
      <Stat label={diff === null ? 'IMC' : diff === 0 ? 'Diferencia' : diff < 0 ? 'Por bajar' : 'Por subir'} value={diff === null ? b.toLocaleString('es-AR', { maximumFractionDigits: 1 }) : diff === 0 ? '¡Logrado!' : kg(Math.abs(diff))} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-raised p-3">
      <div className="num text-[17px] font-semibold">{value}</div>
      <div className="text-[12px] text-muted">{label}</div>
    </div>
  );
}

function TodayHero({ trainsToday, sessionMinutes }: { trainsToday: boolean; sessionMinutes: number }) {
  const day = useTodayDay();
  const open = useOpenWorkout();
  if (day === undefined) return <div className="h-44 rounded-3xl bg-surface" aria-hidden />;

  let title: string;
  let sub: string;
  let cta: { to: string; label: string };
  let active: boolean;
  if (open) {
    active = true;
    title = open.name;
    sub = 'Tenés una sesión en curso.';
    cta = { to: `/entrenar/sesion/${open.id}`, label: 'Retomar' };
  } else if (day) {
    const rest = day.session_type === 'rest';
    const done = day.status === 'completed';
    active = !rest && !done && day.status !== 'skipped';
    title = day.planned.title;
    sub = done
      ? '¡Hecho! Buen trabajo.'
      : rest
        ? 'Recuperarse también es parte del plan. Una caminata suave suma.'
        : `${SESSION_LABELS[day.session_type]} · ~${day.planned.estimated_minutes} min${day.planned.exercises.length ? ` · ${day.planned.exercises.length} ejercicios` : ''}`;
    cta = { to: `/entrenar/dia/${day.id}`, label: active ? 'Ver sesión de hoy' : 'Ver el día' };
  } else {
    active = trainsToday;
    title = trainsToday ? 'Día de entrenamiento' : 'Día de descanso';
    sub = trainsToday ? `${sessionMinutes} minutos reservados para vos. Armá tu plan para saber qué hacer.` : 'Recuperarse también es parte del plan. Una caminata suave suma.';
    cta = { to: '/entrenar/nuevo', label: 'Armar mi plan' };
  }

  return (
    <section className={cx('rounded-3xl p-5', active ? 'bg-accent text-accent-ink' : 'border border-line bg-surface')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cx('text-[13px] font-semibold tracking-wide uppercase', active ? 'opacity-70' : 'text-muted')}>Hoy</p>
          <p className="mt-1 text-[22px] leading-tight font-bold">{title}</p>
          <p className={cx('mt-1 text-[14px]', active ? 'opacity-75' : 'text-muted')}>{sub}</p>
        </div>
        {active ? <Dumbbell className="size-7 shrink-0" aria-hidden /> : <BedDouble className="size-7 shrink-0 text-muted" aria-hidden />}
      </div>
      <Link to={cta.to} className={cx('mt-5 inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 text-[14px] font-semibold', active ? 'bg-accent-ink text-accent' : 'bg-raised text-ink')}>
        {cta.label} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}

function TodayNutrition({ missing }: { missing: string[] | null }) {
  const day = useDayLog(localToday());
  const targets = useTargets();
  if (!targets) {
    return (
      <Card>
        <SectionTitle>Nutrición de hoy</SectionTitle>
        <p className="text-[14px] text-muted">
          {missing ? `Para estimar tu referencia nos falta: ${missing.join(', ')}. ` : ''}
          <Link to="/perfil" className="text-ink underline underline-offset-4">
            Completar perfil
          </Link>
        </p>
      </Card>
    );
  }
  const kcal = day?.totals.kcal ?? 0;
  const water = day?.water_ml ?? 0;
  const pct = Math.min(100, (kcal / targets.kcal) * 100);
  return (
    <Link to="/nutricion" className="block rounded-3xl border border-line bg-surface p-5">
      <SectionTitle action={<ArrowRight className="size-4 text-muted" aria-hidden />}>Nutrición de hoy</SectionTitle>
      <p className="flex items-baseline gap-2">
        <span className="num text-[32px] leading-none font-bold">{kcal.toLocaleString('es-AR')}</span>
        <span className="text-muted">/ {targets.kcal.toLocaleString('es-AR')} kcal</span>
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-raised">
        <div className={cx('h-full rounded-full', kcal > targets.kcal ? 'bg-warn' : 'bg-accent')} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
        <span>Proteína {Math.round(day?.totals.protein ?? 0)}/{targets.protein} g</span>
        <span className="inline-flex items-center gap-1">
          <Droplets className="size-3.5" aria-hidden /> {(water / 1000).toLocaleString('es-AR', { maximumFractionDigits: 2 })}/{(targets.water_ml / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} L
        </span>
      </div>
    </Link>
  );
}
