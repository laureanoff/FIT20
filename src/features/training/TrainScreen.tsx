import { BedDouble, BookOpen, CalendarPlus, Check, ChevronLeft, ChevronRight, Dumbbell, Footprints, History, Pause, Play, Sparkles, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, SectionTitle, Spinner, cx } from '@/components/ui';
import { localToday, weekday } from '@/core/utils/date';
import { WEEKDAYS } from '@/app/labels';
import type { L, TrainingDay } from '@/lib/db/database';
import type { SessionType } from '@/types/domain';
import { setPlanStatus } from './actions';
import { SESSION_LABELS, dateLabel } from './format';
import { useActivePlan, useCtx, useOpenWorkout, usePlanDays } from './hooks';

export function SessionIcon({ type, className }: { type: SessionType; className?: string }) {
  const Icon = type === 'run' ? Footprints : type === 'rest' ? BedDouble : type === 'active_recovery' ? Sparkles : Dumbbell;
  return <Icon className={className} aria-hidden />;
}

export function TrainScreen() {
  const plan = useActivePlan();
  const open = useOpenWorkout();
  const days = usePlanDays(plan?.id);
  const ctx = useCtx();
  const today = localToday();

  if (plan === undefined || days === undefined) return <Spinner />;

  return (
    <div className="flex flex-col gap-4 pt-3">
      <h1 className="text-[28px] font-bold tracking-tight">Entrenar</h1>

      {open && (
        <Link to={`/entrenar/sesion/${open.id}`} className="flex items-center gap-3 rounded-3xl bg-accent p-5 text-accent-ink">
          <Play className="size-6 shrink-0 fill-current" aria-hidden />
          <span className="flex-1">
            <span className="block text-[13px] font-semibold uppercase opacity-70">En curso</span>
            <span className="block text-[17px] font-bold">Retomar: {open.name}</span>
          </span>
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      )}

      {!plan ? (
        <section className="rounded-3xl border border-line bg-surface p-6">
          <span className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-ink">
            <CalendarPlus className="size-6" aria-hidden />
          </span>
          <h2 className="mt-4 text-[20px] font-bold">Armá tu plan</h2>
          <p className="mt-1 text-[15px] text-muted">De 7 a 90 días, con tus días disponibles, tu equipamiento y tus cuidados. Sin azar: cada sesión sigue reglas claras de progresión y descanso.</p>
          <Link to="/entrenar/nuevo" className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-accent text-[15px] font-semibold text-accent-ink">
            Crear mi plan
          </Link>
        </section>
      ) : (
        <PlanOverview plan={plan} days={days} today={today} onPause={() => void setPlanStatus(ctx, plan, plan.status === 'paused' ? 'active' : 'paused')} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <QuickLink to="/entrenar/biblioteca" icon={<BookOpen className="size-5" />} title="Biblioteca" sub="106 ejercicios" />
        <QuickLink to="/entrenar/historial" icon={<History className="size-5" />} title="Historial" sub="Tus sesiones" />
      </div>
    </div>
  );
}

function QuickLink({ to, icon, title, sub }: { to: string; icon: ReactNode; title: string; sub: string }) {
  return (
    <Link to={to} className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4">
      <span className="grid size-10 place-items-center rounded-xl bg-raised text-muted">{icon}</span>
      <span>
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[13px] text-muted">{sub}</span>
      </span>
    </Link>
  );
}

function PlanOverview({ plan, days, today, onPause }: { plan: { id: string; name: string; status: string; start_date: string; end_date: string; duration_days: number }; days: L<TrainingDay>[]; today: string; onPause: () => void }) {
  const sessions = days.filter((d) => d.session_type !== 'rest');
  const done = sessions.filter((d) => d.status === 'completed').length;
  const todayDay = days.find((d) => d.date === today);
  const dayIndex = todayDay ? todayDay.day_number : today < plan.start_date ? 0 : plan.duration_days;
  const weeks = Math.ceil(days.length / 7);
  const currentWeek = todayDay ? Math.floor((todayDay.day_number - 1) / 7) : today < plan.start_date ? 0 : weeks - 1;
  const [week, setWeek] = useState(currentWeek);
  useEffect(() => setWeek(currentWeek), [currentWeek]);
  const paused = plan.status === 'paused';
  const pct = sessions.length ? Math.round((done / sessions.length) * 100) : 0;
  const finished = today > plan.end_date;

  return (
    <>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-bold">{plan.name}</h2>
            <p className="text-[13px] text-muted">
              {dateLabel(plan.start_date, { day: 'numeric', month: 'short' })} → {dateLabel(plan.end_date, { day: 'numeric', month: 'short' })}
              {dayIndex > 0 && !finished && ` · día ${dayIndex} de ${plan.duration_days}`}
            </p>
          </div>
          <button type="button" onClick={onPause} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-raised px-3 text-[13px] font-medium">
            {paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
            {paused ? 'Reanudar' : 'Pausar'}
          </button>
        </div>
        <div className="mt-4 flex items-baseline justify-between">
          <span className="num text-[28px] font-bold">
            {done}
            <span className="text-[16px] font-medium text-muted">/{sessions.length}</span>
          </span>
          <span className="text-[13px] text-muted">sesiones hechas · {pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso del plan">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        {paused && <p className="mt-3 rounded-xl bg-warn/12 px-3 py-2 text-[13px] text-warn">Plan en pausa: tus días siguen acá cuando quieras volver.</p>}
        {finished && (
          <p className="mt-3 rounded-xl bg-ok/12 px-3 py-2 text-[13px] text-ok">
            ¡Terminaste el plan!{' '}
            <Link to="/entrenar/nuevo" className="font-semibold underline">
              Armá el siguiente
            </Link>
          </p>
        )}
      </Card>

      {todayDay && <TodayCard day={todayDay} />}

      <Card>
        <SectionTitle
          action={
            <span className="flex items-center gap-1">
              <button type="button" aria-label="Semana anterior" disabled={week === 0} onClick={() => setWeek((w) => w - 1)} className="grid size-9 place-items-center rounded-full bg-raised disabled:opacity-30">
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" aria-label="Semana siguiente" disabled={week >= weeks - 1} onClick={() => setWeek((w) => w + 1)} className="grid size-9 place-items-center rounded-full bg-raised disabled:opacity-30">
                <ChevronRight className="size-4" />
              </button>
            </span>
          }
        >
          Semana {week + 1} de {weeks}
          {days[week * 7]?.planned.is_deload ? ' · descarga' : ''}
        </SectionTitle>
        <ul className="flex flex-col gap-1.5">
          {days.slice(week * 7, week * 7 + 7).map((d) => (
            <li key={d.id}>
              <DayRow day={d} today={today} />
            </li>
          ))}
        </ul>
      </Card>

      <Link to="/entrenar/nuevo" className="self-center py-2 text-[14px] text-muted underline underline-offset-4">
        Crear un plan nuevo
      </Link>
    </>
  );
}

function TodayCard({ day }: { day: L<TrainingDay> }) {
  const rest = day.session_type === 'rest';
  const done = day.status === 'completed';
  return (
    <Link to={`/entrenar/dia/${day.id}`} className={cx('block rounded-3xl p-5', rest || done ? 'border border-line bg-surface' : 'bg-accent text-accent-ink')}>
      <p className={cx('text-[13px] font-semibold uppercase', rest || done ? 'text-muted' : 'opacity-70')}>Hoy · {SESSION_LABELS[day.session_type]}</p>
      <p className="mt-1 text-[22px] leading-tight font-bold">{day.planned.title}</p>
      <p className={cx('mt-1 text-[14px]', rest || done ? 'text-muted' : 'opacity-75')}>
        {done ? '¡Hecho! Buen trabajo.' : rest ? 'Descanso completo.' : `~${day.planned.estimated_minutes} min · ${day.planned.exercises.length} ejercicios${day.planned.run ? ` · ${day.planned.run.distance_km} km` : ''}`}
      </p>
      {!rest && !done && <span className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-accent-ink px-4 text-[14px] font-semibold text-accent">Ver sesión de hoy <ChevronRight className="size-4" aria-hidden /></span>}
    </Link>
  );
}

function DayRow({ day, today }: { day: L<TrainingDay>; today: string }) {
  const wd = WEEKDAYS.find((w) => w.value === weekday(day.date))!;
  const isToday = day.date === today;
  const past = day.date < today;
  const rest = day.session_type === 'rest';
  return (
    <Link to={`/entrenar/dia/${day.id}`} className={cx('flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2', isToday ? 'bg-accent/12 ring-1 ring-accent' : 'bg-raised/60')}>
      <span className="flex w-9 flex-col items-center leading-none">
        <span className="text-[11px] text-muted">{wd.short}</span>
        <span className="num text-[17px] font-bold">{Number(day.date.slice(8))}</span>
      </span>
      <SessionIcon type={day.session_type} className={cx('size-4 shrink-0', rest ? 'text-faint' : 'text-muted')} />
      <span className={cx('min-w-0 flex-1 truncate text-[14px]', rest ? 'text-faint' : 'font-medium')}>{day.planned.title}</span>
      {day.status === 'completed' ? (
        <span className="grid size-6 place-items-center rounded-full bg-ok text-bg" aria-label="Hecho">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      ) : day.status === 'skipped' ? (
        <span className="grid size-6 place-items-center rounded-full bg-raised text-faint" aria-label="Salteado">
          <X className="size-3.5" />
        </span>
      ) : day.status === 'started' ? (
        <span className="text-[12px] font-semibold text-accent">En curso</span>
      ) : past && !rest ? (
        <span className="text-[12px] text-faint">Pendiente</span>
      ) : !rest ? (
        <span className="num text-[12px] text-muted">{day.planned.estimated_minutes}′</span>
      ) : null}
    </Link>
  );
}
