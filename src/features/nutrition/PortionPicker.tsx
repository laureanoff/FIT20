import { ArrowLeftRight, Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, ErrorBox, cx } from '@/components/ui';
import { macrosFor } from '@/core/nutrition/log';
import type { FoodItem, MealType } from '@/types/domain';
import { MEALS, cookingPair, displayName } from './actions';

const STATE_LABEL = { raw: 'crudo', cooked: 'cocido', na: '' } as const;

export function foodSubtitle(f: FoodItem): string {
  const per = f.is_liquid ? '100 ml' : '100 g';
  return `${f.kcal} kcal · ${per}${f.state !== 'na' ? ` · ${STATE_LABEL[f.state]}` : ''}`;
}

/** Elegir cantidad, unidad y comida; muestra los macros en vivo. */
export function PortionPicker({
  food,
  initial,
  onConfirm,
  onCancel,
  onSwitchFood,
  confirmLabel = 'Agregar',
}: {
  food: FoodItem;
  initial: { quantity: number; unit: string; meal: MealType };
  onConfirm: (quantity: number, unit: string, meal: MealType) => Promise<void>;
  onCancel: () => void;
  onSwitchFood?: (food: FoodItem, grams: number) => void;
  confirmLabel?: string;
}) {
  const base = food.is_liquid ? 'ml' : 'g';
  const units = [base, ...Object.keys(food.portions)];
  const [unit, setUnit] = useState(units.includes(initial.unit) ? initial.unit : base);
  const [qty, setQty] = useState(String(initial.quantity).replace('.', ','));
  const [meal, setMeal] = useState<MealType>(initial.meal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(qty.replace(',', '.'));
  const valid = Number.isFinite(n) && n > 0;
  const m = useMemo(() => (valid ? macrosFor(food, n, unit) : null), [food, n, unit, valid]);
  const pair = cookingPair(food);
  const step = unit === 'g' || unit === 'ml' ? (n >= 100 ? 25 : 10) : 0.5;

  function bump(d: number) {
    const v = Math.max(step, Math.round(((valid ? n : 0) + d) * 100) / 100);
    setQty(String(v).replace('.', ','));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[20px] leading-tight font-bold">{displayName(food)}</h2>
        <p className="text-[13px] text-muted">{foodSubtitle(food)}</p>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" aria-label="Menos" onClick={() => bump(-step)} className="grid size-12 shrink-0 place-items-center rounded-xl bg-raised">
          <Minus className="size-4" />
        </button>
        <label className="flex-1">
          <span className="sr-only">Cantidad</span>
          <input
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d,.]/g, '').slice(0, 7))}
            className="num h-12 w-full rounded-xl border border-line bg-surface text-center text-[22px] font-bold outline-none focus:border-accent"
          />
        </label>
        <button type="button" aria-label="Más" onClick={() => bump(step)} className="grid size-12 shrink-0 place-items-center rounded-xl bg-raised">
          <Plus className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Unidad">
        {units.map((u) => (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={unit === u}
            onClick={() => {
              if (u === unit) return;
              setUnit(u);
              setQty(u === base ? String(food.portions[unit] ? Math.round((valid ? n : 1) * food.portions[unit]!) : 100) : '1');
            }}
            className={cx('min-h-10 rounded-full border px-3.5 text-[14px]', unit === u ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface')}
          >
            {u}
            {u !== base && <span className={cx('ml-1 text-[12px]', unit === u ? 'opacity-70' : 'text-muted')}>({food.portions[u]} {base})</span>}
          </button>
        ))}
      </div>

      {pair && onSwitchFood && (
        <button
          type="button"
          onClick={() => {
            const grams = m?.grams ?? 100;
            const converted = food.state === 'raw' ? grams * pair.yieldFactor : grams / pair.yieldFactor;
            onSwitchFood(pair.other, Math.round(converted));
          }}
          className="flex items-start gap-2 rounded-2xl bg-warn/12 px-3 py-2.5 text-left text-[13px] text-warn"
        >
          <ArrowLeftRight className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Esto es peso <strong>{STATE_LABEL[food.state]}</strong>. ¿Lo pesaste {food.state === 'raw' ? 'cocido' : 'crudo'}? Tocá para cambiar (≈ {m ? Math.round(food.state === 'raw' ? m.grams * pair.yieldFactor : m.grams / pair.yieldFactor) : '—'} g {food.state === 'raw' ? 'cocidos' : 'crudos'}).
          </span>
        </button>
      )}

      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          ['kcal', m?.kcal],
          ['Proteína', m?.protein],
          ['Carbos', m?.carbs],
          ['Grasas', m?.fat],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-2xl bg-raised px-1 py-2.5">
            <div className="num text-[17px] font-bold">{v === undefined ? '—' : (v as number).toLocaleString('es-AR')}</div>
            <div className="text-[11px] text-muted">{k === 'kcal' ? 'kcal' : `${k} (g)`}</div>
          </div>
        ))}
      </div>
      {m && unit !== base && <p className="-mt-2 text-center text-[12px] text-muted">= {m.grams.toLocaleString('es-AR')} {base}</p>}

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Comida">
        {MEALS.map((x) => (
          <button key={x.type} type="button" role="radio" aria-checked={meal === x.type} onClick={() => setMeal(x.type)} className={cx('min-h-10 rounded-full px-3.5 text-[14px]', meal === x.type ? 'bg-ink text-bg' : 'bg-raised text-muted')}>
            {x.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          disabled={!valid}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm(n, unit, meal);
            } catch (e) {
              setBusy(false);
              setError(e instanceof Error ? e.message : 'No se pudo guardar.');
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
