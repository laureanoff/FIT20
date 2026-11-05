import { useLiveQuery } from 'dexie-react-hooks';
import { BookmarkPlus, ChevronLeft, ChevronRight, Droplets, Plus, Search, Settings2, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { type ChangeEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, SectionTitle, Spinner, Toggle, cx } from '@/components/ui';
import { useData, useProfile } from '@/app/data';
import { searchFoods } from '@/core/nutrition/log';
import { addDays, localToday } from '@/core/utils/date';
import { energyFor } from '@/features/profile/energy';
import { dateLabel } from '@/features/training/format';
import { BackLink } from '@/features/training/LibraryScreens';
import { useCtx } from '@/features/training/hooks';
import type { FoodLog, L, SavedMeal } from '@/lib/db/database';
import type { FoodItem, MealType } from '@/types/domain';
import {
  ALL_FOODS,
  MEALS,
  MEAL_LABEL,
  addFood,
  addSavedMeal,
  addWater,
  createCustomFood,
  deleteSavedMeal,
  displayName,
  findFood,
  frequentFoods,
  mealForHour,
  removeFoodLog,
  removeWater,
  saveMeal,
  updateFoodLog,
} from './actions';
import { useCustomFoods, useDayLog, useRecentLogs, useSavedMeals, useTargets } from './hooks';
import { PortionPicker, foodSubtitle } from './PortionPicker';

const fmt = (n: number, d = 0) => n.toLocaleString('es-AR', { maximumFractionDigits: d });

function useDateParam(): [string, (d: string) => void] {
  const [params, setParams] = useSearchParams();
  const today = localToday();
  const d = params.get('fecha');
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : today;
  return [date, (next) => setParams(next === today ? {} : { fecha: next }, { replace: true })];
}

// ───────── Día ─────────

export function NutritionScreen() {
  const [date, setDate] = useDateParam();
  const today = localToday();
  const day = useDayLog(date);
  const targets = useTargets();
  const ctx = useCtx();
  const [savingMeal, setSavingMeal] = useState<MealType | null>(null);

  if (!day) return <Spinner />;
  const { logs, totals, water, water_ml } = day;
  const pct = targets ? Math.min(100, (totals.kcal / targets.kcal) * 100) : 0;
  const left = targets ? targets.kcal - totals.kcal : null;

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold tracking-tight">Nutrición</h1>
        <Link to="/nutricion/objetivos" aria-label="Objetivos diarios" className="grid size-10 place-items-center rounded-full bg-raised text-muted">
          <Settings2 className="size-5" />
        </Link>
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-raised p-1">
        <button type="button" aria-label="Día anterior" onClick={() => setDate(addDays(date, -1))} className="grid size-10 place-items-center rounded-xl">
          <ChevronLeft className="size-5" />
        </button>
        <span className="text-[15px] font-semibold">{date === today ? 'Hoy' : date === addDays(today, -1) ? 'Ayer' : dateLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        <button type="button" aria-label="Día siguiente" disabled={date >= today} onClick={() => setDate(addDays(date, 1))} className="grid size-10 place-items-center rounded-xl disabled:opacity-25">
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* Resumen */}
      <Card>
        {targets ? (
          <>
            <div className="flex items-end justify-between">
              <div>
                <p className="num text-[36px] leading-none font-bold">{fmt(totals.kcal)}</p>
                <p className="mt-1 text-[13px] text-muted">de {fmt(targets.kcal)} kcal</p>
              </div>
              <p className={cx('text-right text-[14px] font-semibold', left! < 0 ? 'text-warn' : 'text-ink')}>
                {left! >= 0 ? `Quedan ${fmt(left!)}` : `${fmt(-left!)} de más`}
                <span className="block text-[12px] font-normal text-muted">{targets.custom ? 'objetivo propio' : 'referencia estimada'}</span>
              </p>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Calorías del día">
              <div className={cx('h-full rounded-full', left! < 0 ? 'bg-warn' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <MacroBar label="Proteína" value={totals.protein} target={targets.protein} />
              <MacroBar label="Carbos" value={totals.carbs} target={targets.carbs} />
              <MacroBar label="Grasas" value={totals.fat} target={targets.fat} />
            </div>
          </>
        ) : (
          <p className="text-[14px] text-muted">
            {fmt(totals.kcal)} kcal registradas.{' '}
            <Link to="/nutricion/objetivos" className="text-ink underline underline-offset-4">
              Definí un objetivo
            </Link>
          </p>
        )}
      </Card>

      <PlanCard date={date} />

      {/* Agua */}
      <Card>
        <div className="flex items-center justify-between">
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              <Droplets className="size-3.5" aria-hidden /> Agua
            </span>
          </SectionTitle>
          {water.length > 0 && (
            <button type="button" onClick={() => void removeWater(ctx, water[water.length - 1]!)} className="-mt-3 inline-flex min-h-9 items-center gap-1 text-[13px] text-muted">
              <Undo2 className="size-3.5" aria-hidden /> Deshacer
            </button>
          )}
        </div>
        <p className="num text-[24px] font-bold">
          {(water_ml / 1000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} L
          {targets && <span className="text-[14px] font-normal text-muted"> / {(targets.water_ml / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} L</span>}
        </p>
        {targets && (
          <div className="mt-2 flex gap-1" aria-hidden>
            {Array.from({ length: Math.max(1, Math.round(targets.water_ml / 250)) }, (_, i) => (
              <span key={i} className={cx('h-6 flex-1 rounded-md', (i + 1) * 250 <= water_ml ? 'bg-[#5ab0ff]' : 'bg-raised')} />
            ))}
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[250, 500, 750].map((ml) => (
            <button key={ml} type="button" onClick={() => void addWater(ctx, ml, date)} className="min-h-11 rounded-xl bg-raised text-[14px] font-semibold">
              + {ml} ml
            </button>
          ))}
        </div>
      </Card>

      {/* Comidas */}
      {MEALS.map((meal) => {
        const items = logs.filter((l) => l.meal_type === meal.type);
        const kcal = items.reduce((a, l) => a + l.calories, 0);
        return (
          <section key={meal.type} className="rounded-3xl border border-line bg-surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-[16px] font-bold">
                {meal.label} {items.length > 0 && <span className="num text-[14px] font-normal text-muted">· {fmt(kcal)} kcal</span>}
              </h2>
              <div className="flex items-center gap-1">
                {items.length > 0 && (
                  <button type="button" aria-label={`Guardar ${meal.label} como comida frecuente`} onClick={() => setSavingMeal(savingMeal === meal.type ? null : meal.type)} className="grid size-10 place-items-center rounded-full text-muted">
                    <BookmarkPlus className="size-4" />
                  </button>
                )}
                <Link to={`/nutricion/agregar?comida=${meal.type}&fecha=${date}`} aria-label={`Agregar a ${meal.label}`} className="grid size-10 place-items-center rounded-full bg-accent text-accent-ink">
                  <Plus className="size-5" />
                </Link>
              </div>
            </div>
            {savingMeal === meal.type && <SaveMealForm logs={items} onDone={() => setSavingMeal(null)} />}
            {items.length > 0 ? (
              <ul className="divide-y divide-line border-t border-line">
                {items.map((l) => (
                  <li key={l.id}>
                    <Link to={`/nutricion/registro/${l.id}`} className="flex min-h-14 items-center gap-3 px-5 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">{l.food_name}</span>
                        <span className="block text-[12px] text-muted">
                          {fmt(l.quantity, 2)} {l.unit}
                          {l.unit !== 'g' && l.unit !== 'ml' ? ` (${fmt(l.grams)} g)` : ''} · P {fmt(l.protein, 1)} · C {fmt(l.carbohydrates, 1)} · G {fmt(l.fats, 1)}
                        </span>
                      </span>
                      <span className="num text-[14px] font-semibold">{fmt(l.calories)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-4 text-[13px] text-faint">Sin registros</p>
            )}
          </section>
        );
      })}

      <p className="px-1 text-[12px] text-faint">Los valores son aproximados (tablas de composición de referencia) y varían según marca y preparación. Ante una condición médica, seguí las indicaciones de tu profesional.</p>
    </div>
  );
}

function MacroBar({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="num text-[15px] font-semibold">
        {fmt(value)}
        <span className="text-[12px] font-normal text-muted">/{fmt(target)} g</span>
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-ink/70" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SaveMealForm({ logs, onDone }: { logs: L<FoodLog>[]; onDone: () => void }) {
  const ctx = useCtx();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-5 mb-3 flex flex-col gap-2 rounded-2xl bg-raised p-3">
      <p className="text-[13px] text-muted">Guardá estos {logs.length} alimentos para cargarlos con un toque otro día.</p>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ej.: Desayuno habitual" aria-label="Nombre de la comida" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[16px] outline-none focus:border-accent" />
        <Button
          className="min-h-11"
          onClick={async () => {
            try {
              await saveMeal(ctx, name, logs);
              onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'No se pudo guardar.');
            }
          }}
        >
          Guardar
        </Button>
      </div>
      {error && <p className="text-[13px] text-danger">{error}</p>}
    </div>
  );
}

// ───────── Agregar ─────────

type Tab = 'buscar' | 'frecuentes' | 'comidas';

export function AddFoodScreen() {
  const [params] = useSearchParams();
  const ctx = useCtx();
  const today = localToday();
  const date = params.get('fecha') ?? today;
  const mealParam = params.get('comida') as MealType | null;
  const meal: MealType = mealParam && MEAL_LABEL[mealParam] ? mealParam : mealForHour(new Date().getHours() + new Date().getMinutes() / 60);
  const custom = useCustomFoods();
  const recent = useRecentLogs();
  const saved = useSavedMeals();
  const [tab, setTab] = useState<Tab>('buscar');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ food: FoodItem; quantity: number; unit: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const all = useMemo(() => [...(custom ?? []), ...ALL_FOODS], [custom]);
  const results = useMemo(() => searchFoods(all, q, 40), [all, q]);
  const frequent = useMemo(() => (recent ? frequentFoods(recent) : []), [recent]);
  const back = `/nutricion${date !== today ? `?fecha=${date}` : ''}`;

  if (!custom || !recent || !saved) return <Spinner />;

  if (picked) {
    return (
      <div className="pt-4">
        <PortionPicker
          key={picked.food.id}
          food={picked.food}
          initial={{ quantity: picked.quantity, unit: picked.unit, meal }}
          onCancel={() => setPicked(null)}
          onSwitchFood={(food, grams) => setPicked({ food, quantity: grams, unit: food.is_liquid ? 'ml' : 'g' })}
          onConfirm={async (quantity, unit, m) => {
            await addFood(ctx, picked.food, quantity, unit, date, m);
            setPicked(null);
            setQ('');
            setNotice(`${displayName(picked.food)} agregado a ${MEAL_LABEL[m].toLowerCase()}.`);
          }}
        />
      </div>
    );
  }

  const pick = (food: FoodItem, quantity?: number, unit?: string) => {
    const firstPortion = Object.keys(food.portions)[0];
    setNotice(null);
    setPicked({ food, quantity: quantity ?? (firstPortion ? 1 : 100), unit: unit ?? firstPortion ?? (food.is_liquid ? 'ml' : 'g') });
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to={back} label="Nutrición" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">Agregar a {MEAL_LABEL[meal].toLowerCase()}</h1>
        {date !== today && <p className="text-[14px] text-muted">{dateLabel(date)}</p>}
      </div>

      {notice && (
        <p role="status" className="flex items-center justify-between gap-3 rounded-2xl bg-ok/15 px-4 py-3 text-[14px] text-ok">
          {notice}
          <Link to={back} className="shrink-0 font-semibold underline">
            Listo
          </Link>
        </p>
      )}

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-raised p-1" role="tablist">
        {(
          [
            ['buscar', 'Buscar'],
            ['frecuentes', 'Frecuentes'],
            ['comidas', 'Mis comidas'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('min-h-10 rounded-xl text-[14px] font-medium', tab === t ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'buscar' && (
        <>
          <label className="flex min-h-12 items-center gap-2 rounded-xl border border-line bg-surface px-4 focus-within:border-accent">
            <Search className="size-4 text-muted" aria-hidden />
            <span className="sr-only">Buscar alimento</span>
            <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: milanesa, banana, yogur…" className="w-full bg-transparent text-[16px] outline-none placeholder:text-faint" />
          </label>
          {results.length ? (
            <FoodList foods={results} onPick={(f) => pick(f)} />
          ) : (
            <p className="rounded-3xl border border-dashed border-line p-6 text-center text-[14px] text-muted">No encontramos "{q}".</p>
          )}
          <Link to="/nutricion/alimento-nuevo" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-raised text-[15px] font-semibold">
            <Plus className="size-4" aria-hidden /> Crear un alimento propio
          </Link>
        </>
      )}

      {tab === 'frecuentes' &&
        (frequent.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {frequent.map((fr) => {
                const food = findFood(fr.food_item_id, custom);
                if (!food) return null;
                return (
                  <li key={fr.food_item_id}>
                    <button type="button" onClick={() => pick(food, fr.quantity, fr.unit)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">{displayName(food)}</span>
                        <span className="block text-[12px] text-muted">
                          Última vez: {fmt(fr.quantity, 2)} {fr.unit} · {fr.count} {fr.count === 1 ? 'vez' : 'veces'}
                        </span>
                      </span>
                      <Plus className="size-4 text-muted" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <p className="rounded-3xl border border-dashed border-line p-6 text-center text-[14px] text-muted">Los alimentos que registres seguido van a aparecer acá.</p>
        ))}

      {tab === 'comidas' &&
        (saved.length ? (
          <ul className="flex flex-col gap-2">
            {saved.map((sm) => (
              <SavedMealRow
                key={sm.id}
                meal={sm}
                custom={custom}
                onAdd={async () => {
                  const missing = await addSavedMeal(ctx, sm, custom, date, meal);
                  setNotice(`${sm.name} agregada a ${MEAL_LABEL[meal].toLowerCase()}.${missing.length ? ` ${missing.length} alimento(s) ya no existen y se omitieron.` : ''}`);
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-3xl border border-dashed border-line p-6 text-center text-[14px] text-muted">
            Guardá una comida que repetís (el ícono <BookmarkPlus className="inline size-3.5" aria-label="guardar" /> en cada comida del día) para cargarla con un toque.
          </p>
        ))}
    </div>
  );
}

function FoodList({ foods, onPick }: { foods: FoodItem[]; onPick: (f: FoodItem) => void }) {
  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {foods.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onPick(f)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-snug">{displayName(f)}</span>
                <span className="block text-[12px] text-muted">
                  {foodSubtitle(f)}
                  {f.user_id ? ' · propio' : ''}
                </span>
              </span>
              <Plus className="size-4 shrink-0 text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SavedMealRow({ meal, custom, onAdd }: { meal: L<SavedMeal>; custom: FoodItem[]; onAdd: () => Promise<void> }) {
  const ctx = useCtx();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const names = meal.items.map((i) => findFood(i.food_item_id, custom)?.name ?? '—');
  return (
    <li className="rounded-3xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{meal.name}</p>
          <p className="text-[13px] text-muted">{names.join(', ')}</p>
        </div>
        <button type="button" aria-label={`Borrar ${meal.name}`} onClick={() => (confirm ? void deleteSavedMeal(ctx, meal) : setConfirm(true))} className={cx('grid size-9 shrink-0 place-items-center rounded-full', confirm ? 'bg-danger/15 text-danger' : 'text-faint')}>
          <Trash2 className="size-4" />
        </button>
      </div>
      <Button
        variant="secondary"
        className="mt-3 w-full"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await onAdd();
          setBusy(false);
        }}
      >
        <Plus className="size-4" aria-hidden /> Agregar
      </Button>
    </li>
  );
}

// ───────── Editar un registro ─────────

export function EditFoodLogScreen() {
  const { id } = useParams();
  const { db } = useData();
  const ctx = useCtx();
  const navigate = useNavigate();
  const custom = useCustomFoods();
  const log = useLiveQuery(async () => {
    const l = id ? await db.food_logs.get(id) : undefined;
    return l && !l.deleted_at ? l : null;
  }, [db, id]);
  const [confirm, setConfirm] = useState(false);

  if (log === undefined || !custom) return <Spinner />;
  if (!log) return <p className="pt-6 text-muted">Registro no encontrado.</p>;
  const food = findFood(log.food_item_id, custom);
  const back = `/nutricion${log.log_date !== localToday() ? `?fecha=${log.log_date}` : ''}`;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <BackLink to={back} label="Nutrición" />
      {food ? (
        <PortionPicker
          food={food}
          initial={{ quantity: log.quantity, unit: log.unit, meal: log.meal_type }}
          confirmLabel="Guardar cambios"
          onCancel={() => navigate(back)}
          onConfirm={async (q, u, m) => {
            await updateFoodLog(ctx, log, food, q, u, m);
            navigate(back, { replace: true });
          }}
        />
      ) : (
        <p className="text-muted">Este alimento ya no está disponible; solo podés borrarlo.</p>
      )}
      {confirm ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await removeFoodLog(ctx, log);
              navigate(back, { replace: true });
            }}
          >
            <Trash2 className="size-4" aria-hidden /> Borrar
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="self-center py-2 text-[14px] text-danger">
          Borrar este registro
        </button>
      )}
    </div>
  );
}

// ───────── Alimento propio ─────────

export function CustomFoodScreen() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [v, setV] = useState({ name: '', brand: '', kcal: '', protein: '', carbs: '', fat: '', portion_name: '', portion_grams: '' });
  const [liquid, setLiquid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (s: string) => Number(s.replace(',', '.'));
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const unit = liquid ? 'ml' : 'g';

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink label="Volver" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">Alimento propio</h1>
        <p className="text-[14px] text-muted">Copiá los valores de la tabla nutricional del envase, siempre cada 100 {unit}.</p>
      </div>
      <Field label="Nombre" value={v.name} maxLength={80} onChange={set('name')} placeholder="Ej.: Barrita de cereal" />
      <Field label="Marca (opcional)" value={v.brand} maxLength={40} onChange={set('brand')} />
      <Toggle label="Es un líquido" description="Los valores van cada 100 ml" checked={liquid} onChange={setLiquid} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Calorías / 100 ${unit}`} inputMode="decimal" suffix="kcal" value={v.kcal} onChange={set('kcal')} />
        <Field label="Proteínas" inputMode="decimal" suffix="g" value={v.protein} onChange={set('protein')} />
        <Field label="Carbohidratos" inputMode="decimal" suffix="g" value={v.carbs} onChange={set('carbs')} />
        <Field label="Grasas" inputMode="decimal" suffix="g" value={v.fat} onChange={set('fat')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Porción (opcional)" placeholder="unidad" value={v.portion_name} maxLength={20} onChange={set('portion_name')} />
        <Field label="Peso de la porción" inputMode="decimal" suffix={unit} value={v.portion_grams} onChange={set('portion_grams')} />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await createCustomFood(ctx, {
              name: v.name,
              brand: v.brand,
              kcal: num(v.kcal),
              protein: num(v.protein || '0'),
              carbs: num(v.carbs || '0'),
              fat: num(v.fat || '0'),
              portion_name: v.portion_name,
              portion_grams: v.portion_grams ? num(v.portion_grams) : null,
              is_liquid: liquid,
            });
            navigate(-1);
          } catch (e) {
            setBusy(false);
            setError(e instanceof Error ? e.message : 'No se pudo guardar.');
          }
        }}
      >
        Guardar alimento
      </Button>
    </div>
  );
}

// ───────── Objetivos ─────────

export function TargetsScreen() {
  const profile = useProfile();
  const { settings, saveSettings } = useData();
  const navigate = useNavigate();
  const auto = energyFor(profile);
  const stored = settings.nutrition_targets;
  const [manual, setManual] = useState(!!stored?.kcal);
  const init = (k: string, fallback: number | undefined) => String(stored?.[k] ?? fallback ?? '');
  const [v, setV] = useState({
    kcal: init('kcal', auto.status === 'ok' ? auto.target_kcal : undefined),
    protein: init('protein', auto.status === 'ok' ? auto.protein_g : undefined),
    carbs: init('carbs', auto.status === 'ok' ? auto.carbs_g : undefined),
    fat: init('fat', auto.status === 'ok' ? auto.fat_g : undefined),
    water_ml: init('water_ml', auto.status === 'ok' ? auto.water_ml : 2000),
  });
  const [error, setError] = useState<string | null>(null);
  const n = (s: string) => Math.round(Number(s.replace(',', '.')));
  const fromMacros = n(v.protein) * 4 + n(v.carbs) * 4 + n(v.fat) * 9;

  async function save() {
    if (!manual) {
      await saveSettings({ nutrition_targets: null });
      return navigate('/nutricion');
    }
    const t = { kcal: n(v.kcal), protein: n(v.protein), carbs: n(v.carbs), fat: n(v.fat), water_ml: n(v.water_ml) };
    if (!(t.kcal >= 800 && t.kcal <= 6000)) return setError('Las calorías deben estar entre 800 y 6000.');
    if ([t.protein, t.carbs, t.fat].some((x) => !(x >= 0 && x <= 600))) return setError('Revisá los gramos de cada macro (0 a 600).');
    if (!(t.water_ml >= 500 && t.water_ml <= 8000)) return setError('El agua debe estar entre 500 y 8000 ml.');
    await saveSettings({ nutrition_targets: t });
    navigate('/nutricion');
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/nutricion" label="Nutrición" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">Objetivos diarios</h1>
      </div>
      <Card>
        <Toggle label="Usar mis propios objetivos" description={manual ? 'Por ejemplo, los que te indicó tu nutricionista.' : 'Se calculan con tu perfil y se actualizan si cambia tu peso o tu objetivo.'} checked={manual} onChange={setManual} />
        {!manual && auto.status === 'ok' && (
          <dl className="mt-4 grid grid-cols-2 gap-2 text-[14px]">
            {[
              ['Calorías', `${fmt(auto.target_kcal)} kcal`],
              ['Proteína', `${auto.protein_g} g`],
              ['Carbohidratos', `${auto.carbs_g} g`],
              ['Grasas', `${auto.fat_g} g`],
              ['Agua', `${(auto.water_ml / 1000).toLocaleString('es-AR')} L`],
              ['Gasto estimado', `${fmt(auto.tdee)} kcal`],
            ].map(([k, val]) => (
              <div key={k} className="rounded-2xl bg-raised p-3">
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="num font-semibold">{val}</dd>
              </div>
            ))}
          </dl>
        )}
        {!manual && auto.status !== 'ok' && <p className="mt-3 text-[14px] text-muted">Completá tu perfil para calcular la referencia.</p>}
      </Card>
      {manual && (
        <Card>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Calorías" inputMode="numeric" suffix="kcal" value={v.kcal} onChange={(e) => setV({ ...v, kcal: e.target.value })} />
            <Field label="Agua" inputMode="numeric" suffix="ml" value={v.water_ml} onChange={(e) => setV({ ...v, water_ml: e.target.value })} />
            <Field label="Proteína" inputMode="numeric" suffix="g" value={v.protein} onChange={(e) => setV({ ...v, protein: e.target.value })} />
            <Field label="Carbohidratos" inputMode="numeric" suffix="g" value={v.carbs} onChange={(e) => setV({ ...v, carbs: e.target.value })} />
            <Field label="Grasas" inputMode="numeric" suffix="g" value={v.fat} onChange={(e) => setV({ ...v, fat: e.target.value })} />
          </div>
          {Number.isFinite(fromMacros) && fromMacros > 0 && Math.abs(fromMacros - n(v.kcal)) > 150 && (
            <p className="mt-3 text-[13px] text-warn">Los macros suman ≈ {fmt(fromMacros)} kcal, distinto de las calorías indicadas.</p>
          )}
        </Card>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button onClick={save}>Guardar</Button>
      <p className="text-[12px] text-faint">Estas cifras son orientativas y no reemplazan la indicación de un profesional de la salud.</p>
    </div>
  );
}


/** Acceso al plan de alimentación con la próxima comida pendiente del día. */
function PlanCard({ date }: { date: string }) {
  const { db } = useData();
  const plan = useLiveQuery(async () => (await db.meal_plan_days.where('plan_date').equals(date).toArray()).find((d) => !d.deleted_at) ?? null, [db, date]);
  if (plan === undefined) return null;
  const next = plan?.meals.find((m) => !m.logged);
  return (
    <Link to="/nutricion/plan" className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-ink">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">Plan de alimentación</span>
        <span className="block truncate text-[13px] text-muted">
          {!plan ? 'Armá tus comidas según tu objetivo' : next ? `${MEAL_LABEL[next.meal_type]}: ${next.title}` : '¡Cumpliste el plan del día!'}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
    </Link>
  );
}
