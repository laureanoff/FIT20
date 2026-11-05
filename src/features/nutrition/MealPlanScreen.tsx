import { useLiveQuery } from 'dexie-react-hooks';
import { Check, RefreshCw, Shuffle, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorBox, Spinner, cx } from '@/components/ui';
import { useData, useProfile } from '@/app/data';
import { GOAL_LABELS, WEEKDAYS } from '@/app/labels';
import { mealTotals } from '@/core/nutrition/mealplan';
import { addDays, localToday, weekday } from '@/core/utils/date';
import { BackLink } from '@/features/training/LibraryScreens';
import { useCtx } from '@/features/training/hooks';
import { alive } from '@/lib/db/database';
import { MEAL_LABEL, displayName, findFood } from './actions';
import { useCustomFoods, useTargets } from './hooks';
import { PLAN_DAYS, type PlanContext, generateWeek, isOutdated, logPlannedMeal, regenerateDay, swapPlannedMeal } from './mealPlanActions';

const fmt = (n: number, d = 0) => n.toLocaleString('es-AR', { maximumFractionDigits: d });

export function MealPlanScreen() {
  const profile = useProfile();
  const targets = useTargets();
  const custom = useCustomFoods();
  const { db } = useData();
  const ctx = useCtx();
  const today = localToday();
  const dates = useMemo(() => Array.from({ length: PLAN_DAYS }, (_, i) => addDays(today, i)), [today]);
  const [sel, setSel] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = useLiveQuery(async () => (await db.meal_plan_days.where('plan_date').between(dates[0]!, dates[dates.length - 1]!, true, true).toArray()).filter(alive), [db, dates]);

  if (!custom || !days) return <Spinner />;
  if (!targets) {
    return (
      <div className="pt-2">
        <BackLink to="/nutricion" label="Nutrición" />
        <p className="mt-4 text-[15px] text-muted">
          Para armar tu plan necesitamos tu objetivo de calorías.{' '}
          <Link to="/nutricion/objetivos" className="text-ink underline underline-offset-4">
            Definirlo
          </Link>
        </p>
      </div>
    );
  }

  const pc: PlanContext = { targets, profile, custom };
  const find = (id: string) => findFood(id, custom);
  const day = days.find((d) => d.plan_date === sel);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo armar el plan.');
    }
    setBusy(null);
  };
  const totals = day ? day.meals.reduce((a, m) => {
    const t = mealTotals(m.items, find);
    return { kcal: a.kcal + t.kcal, protein: a.protein + t.protein, carbs: a.carbs + t.carbs, fat: a.fat + t.fat };
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 }) : null;
  const restrictions = [...profile.dietary_preferences, ...profile.dietary_restrictions];

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/nutricion" label="Nutrición" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">Plan de alimentación</h1>
        <p className="text-[14px] text-muted">
          {GOAL_LABELS[profile.primary_goal].title} · ~{fmt(targets.kcal)} kcal y {fmt(targets.protein)} g de proteína por día
          {restrictions.length ? ` · ${restrictions.join(', ')}` : ''}.{' '}
          <Link to="/perfil/food" className="text-ink underline underline-offset-4">
            Preferencias
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {dates.map((d) => {
          const has = days.some((x) => x.plan_date === d);
          const wd = WEEKDAYS.find((w) => w.value === weekday(d))!;
          return (
            <button key={d} type="button" aria-pressed={sel === d} onClick={() => setSel(d)} className={cx('flex flex-col items-center gap-0.5 rounded-xl py-2', sel === d ? 'bg-accent text-accent-ink' : 'bg-raised')}>
              <span className={cx('text-[11px]', sel === d ? 'opacity-70' : 'text-muted')}>{d === today ? 'Hoy' : wd.short}</span>
              <span className="num text-[16px] font-bold">{Number(d.slice(8))}</span>
              <span className={cx('size-1.5 rounded-full', has ? (sel === d ? 'bg-accent-ink' : 'bg-accent') : 'bg-transparent')} aria-hidden />
            </button>
          );
        })}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {!day ? (
        <section className="rounded-3xl border border-line bg-surface p-6 text-center">
          <Sparkles className="mx-auto size-8 text-accent" aria-hidden />
          <p className="mt-3 text-[16px] font-semibold">{days.length ? 'Este día todavía no está armado' : 'Armá tu semana de comidas'}</p>
          <p className="mt-1 text-[14px] text-muted">Comidas simples con alimentos de acá, con las porciones justas para tu objetivo. Después podés cambiar cualquier comida.</p>
          <Button className="mt-4 w-full" loading={busy === 'week'} onClick={() => run('week', () => generateWeek(ctx, pc, sel, PLAN_DAYS - dates.indexOf(sel)))}>
            Armar {sel === today ? 'mi semana' : 'desde este día'}
          </Button>
        </section>
      ) : (
        <>
          {isOutdated(day, targets) && (
            <div className="flex items-center gap-3 rounded-2xl bg-warn/12 px-4 py-3 text-[14px] text-warn">
              <span className="flex-1">Tu objetivo cambió desde que se armó este plan.</span>
              <button type="button" onClick={() => run('week', () => generateWeek(ctx, pc, sel, PLAN_DAYS - dates.indexOf(sel), `:${Date.now()}`))} className="shrink-0 font-semibold underline">
                Actualizar
              </button>
            </div>
          )}

          {totals && (
            <Card>
              <div className="flex items-baseline justify-between">
                <p className="num text-[28px] font-bold">
                  {fmt(totals.kcal)} <span className="text-[14px] font-normal text-muted">/ {fmt(targets.kcal)} kcal</span>
                </p>
                <button type="button" onClick={() => run('day', () => regenerateDay(ctx, pc, day))} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-raised px-3 text-[13px] font-medium" disabled={busy === 'day'}>
                  <RefreshCw className={cx('size-3.5', busy === 'day' && 'animate-spin')} aria-hidden /> Rearmar día
                </button>
              </div>
              <p className="num mt-1 text-[13px] text-muted">
                Proteína {fmt(totals.protein)}/{fmt(targets.protein)} g · Carbos {fmt(totals.carbs)} g · Grasas {fmt(totals.fat)} g
              </p>
              {totals.protein < targets.protein * 0.85 && <p className="mt-2 text-[13px] text-warn">Este día queda algo corto de proteína: podés sumar un yogur, huevo o legumbres.</p>}
            </Card>
          )}

          {day.meals.map((m, i) => {
            const t = mealTotals(m.items, find);
            return (
              <section key={`${m.meal_type}-${i}`} className={cx('rounded-3xl border bg-surface', m.logged ? 'border-ok/40' : 'border-line')}>
                <div className="px-5 pt-4">
                  <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">
                    {MEAL_LABEL[m.meal_type]} · <span className="num">{fmt(t.kcal)} kcal · {fmt(t.protein)} g prot.</span>
                  </p>
                  <h2 className="mt-1 text-[17px] leading-snug font-bold">{m.title}</h2>
                </div>
                <ul className="mt-2 flex flex-col gap-1 px-5 text-[14px]">
                  {m.items.map((it) => {
                    const f = find(it.food_item_id);
                    const base = f?.is_liquid ? 'ml' : 'g';
                    return (
                      <li key={it.food_item_id} className="flex justify-between gap-3">
                        <span className="min-w-0">{f ? displayName(f) : it.food_item_id}</span>
                        <span className="num shrink-0 text-muted">
                          {it.unit === 'g' || it.unit === 'ml' ? `${fmt(it.grams)} ${it.unit}` : `${fmt(it.quantity, 1)} ${it.unit}${it.quantity > 1 && !it.unit.endsWith('s') ? (/[aeiou]$/.test(it.unit) ? 's' : 'es') : ''} (${fmt(it.grams)} ${base})`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line p-3">
                  {m.logged ? (
                    <span className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 text-[14px] font-semibold text-ok">
                      <Check className="size-4" aria-hidden /> Cargada al registro
                    </span>
                  ) : (
                    <>
                      <Button variant="secondary" className="min-h-11" loading={busy === `swap${i}`} onClick={() => run(`swap${i}`, () => swapPlannedMeal(ctx, pc, day, i))}>
                        <Shuffle className="size-4" aria-hidden /> Cambiar
                      </Button>
                      <Button className="min-h-11" loading={busy === `log${i}`} disabled={day.plan_date > today} onClick={() => run(`log${i}`, () => logPlannedMeal(ctx, pc, day, i))}>
                        <Check className="size-4" aria-hidden /> Lo comí
                      </Button>
                    </>
                  )}
                </div>
              </section>
            );
          })}
          <p className="text-[12px] text-faint">Plan orientativo armado con valores aproximados. No reemplaza la indicación de un nutricionista, sobre todo ante condiciones médicas, embarazo o en menores de 18.</p>
        </>
      )}
    </div>
  );
}
