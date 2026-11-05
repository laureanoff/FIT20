import { ArrowRight, BedDouble, Dumbbell, Droplets, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, SectionTitle, cx } from '@/components/ui';
import { useProfile } from '@/app/data';
import { GOAL_LABELS, WEEKDAYS } from '@/app/labels';
import { bmi } from '@/core/nutrition/energy';
import { addDays, localToday, startOfWeek, weekday } from '@/core/utils/date';
import { energyFor } from '@/features/profile/energy';

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
      <section className={cx('rounded-3xl p-5', trainsToday ? 'bg-accent text-accent-ink' : 'border border-line bg-surface')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cx('text-[13px] font-semibold tracking-wide uppercase', trainsToday ? 'opacity-70' : 'text-muted')}>Hoy</p>
            <p className="mt-1 text-[22px] leading-tight font-bold">{trainsToday ? 'Día de entrenamiento' : 'Día de descanso'}</p>
            <p className={cx('mt-1 text-[14px]', trainsToday ? 'opacity-75' : 'text-muted')}>
              {trainsToday ? `${profile.session_minutes} minutos reservados para vos.` : 'Recuperarse también es parte del plan. Una caminata suave suma.'}
            </p>
          </div>
          {trainsToday ? <Dumbbell className="size-7 shrink-0" aria-hidden /> : <BedDouble className="size-7 shrink-0 text-muted" aria-hidden />}
        </div>
        <Link
          to="/entrenar"
          className={cx('mt-5 inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 text-[14px] font-semibold', trainsToday ? 'bg-accent-ink text-accent' : 'bg-raised text-ink')}
        >
          Ver mi plan <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>

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

      {/* Energía */}
      {energy.status === 'ok' ? (
        <Card>
          <SectionTitle>Referencia diaria</SectionTitle>
          <p className="flex items-baseline gap-2">
            <span className="num text-[36px] leading-none font-bold">{energy.target_kcal.toLocaleString('es-AR')}</span>
            <span className="text-muted">kcal</span>
          </p>
          {energy.target_range && (
            <p className="mt-1 text-[13px] text-muted">
              Rango estimado {energy.target_range[0].toLocaleString('es-AR')}–{energy.target_range[1].toLocaleString('es-AR')} kcal
            </p>
          )}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ['Proteína', energy.protein_g],
              ['Carbos', energy.carbs_g],
              ['Grasas', energy.fat_g],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-raised p-3">
                <div className="num text-[18px] font-semibold">
                  {v}
                  <span className="text-[13px] font-normal text-muted"> g</span>
                </div>
                <div className="text-[12px] text-muted">{k}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-2 text-[14px] text-muted">
            <Droplets className="size-4 text-accent" aria-hidden /> Agua: {(energy.water_ml / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} L por día
          </p>
        </Card>
      ) : (
        <Card>
          <SectionTitle>Referencia diaria</SectionTitle>
          <p className="text-[14px] text-muted">
            Para estimarla nos falta: {energy.missing.join(', ')}.{' '}
            <Link to="/perfil" className="text-ink underline underline-offset-4">
              Completar perfil
            </Link>
          </p>
        </Card>
      )}

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
