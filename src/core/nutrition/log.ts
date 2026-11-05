import type { FoodItem, MacroTotals } from '../../types/domain.ts';

/** Gramos (o ml) a partir de una cantidad y unidad ("g", "ml" o una porción del alimento). */
export function toGrams(food: FoodItem, quantity: number, unit: string): number {
  if (!(quantity > 0) || !Number.isFinite(quantity)) throw new Error('La cantidad debe ser mayor a 0.');
  if (unit === 'g' || unit === 'ml') return quantity;
  const per = food.portions[unit];
  if (!per) throw new Error(`Unidad "${unit}" no disponible para ${food.name}.`);
  return quantity * per;
}

/** Macros de una porción. Redondeo a 1 decimal (kcal a entero). */
export function macrosFor(food: FoodItem, quantity: number, unit: string): MacroTotals & { grams: number } {
  const g = toGrams(food, quantity, unit);
  const k = g / 100;
  return {
    grams: Math.round(g * 10) / 10,
    kcal: Math.round(food.kcal * k),
    protein: Math.round(food.protein * k * 10) / 10,
    carbs: Math.round(food.carbs * k * 10) / 10,
    fat: Math.round(food.fat * k * 10) / 10,
  };
}

export function sumMacros(items: readonly MacroTotals[]): MacroTotals {
  const t = items.reduce(
    (a, b) => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return { kcal: Math.round(t.kcal), protein: Math.round(t.protein * 10) / 10, carbs: Math.round(t.carbs * 10) / 10, fat: Math.round(t.fat * 10) / 10 };
}

/** Cuánto falta (positivo) o cuánto se pasó (negativo) respecto del objetivo. */
export function remaining(consumed: MacroTotals, target: MacroTotals): MacroTotals {
  return {
    kcal: Math.round(target.kcal - consumed.kcal),
    protein: Math.round((target.protein - consumed.protein) * 10) / 10,
    carbs: Math.round((target.carbs - consumed.carbs) * 10) / 10,
    fat: Math.round((target.fat - consumed.fat) * 10) / 10,
  };
}

/**
 * Valida un alimento personalizado: valores por 100 g plausibles y energía coherente con los macros.
 * Devuelve la lista de errores (vacía si es válido).
 */
export function validateCustomFood(f: Pick<FoodItem, 'name' | 'kcal' | 'protein' | 'carbs' | 'fat'>): string[] {
  const errors: string[] = [];
  const name = f.name.trim();
  if (name.length < 2 || name.length > 80) errors.push('El nombre debe tener entre 2 y 80 caracteres.');
  for (const [k, v] of Object.entries({ calorías: f.kcal, proteínas: f.protein, carbohidratos: f.carbs, grasas: f.fat })) {
    if (!Number.isFinite(v) || v < 0) errors.push(`${k}: valor inválido.`);
  }
  if (f.protein + f.carbs + f.fat > 100) errors.push('Proteínas + carbohidratos + grasas no pueden superar 100 g cada 100 g.');
  if (f.kcal > 900) errors.push('Ningún alimento supera ~900 kcal cada 100 g.');
  const est = 4 * f.protein + 4 * f.carbs + 9 * f.fat;
  if (f.kcal > 40 && Math.abs(est - f.kcal) / f.kcal > 0.35) {
    errors.push(`Las calorías no coinciden con los macros (≈${Math.round(est)} kcal según los macros). Revisá la etiqueta.`);
  }
  return errors;
}

/** Búsqueda tolerante a acentos y mayúsculas, con coincidencias al inicio primero. */
export function searchFoods(foods: readonly FoodItem[], query: string, limit = 30): FoodItem[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const q = norm(query);
  if (!q) return foods.slice(0, limit);
  const terms = q.split(/\s+/);
  return foods
    .map((f) => {
      const n = norm(f.name);
      if (!terms.every((t) => n.includes(t) || norm(f.category).includes(t))) return null;
      return { f, score: n.startsWith(q) ? 0 : n.split(/\s+/).some((w) => w.startsWith(terms[0]!)) ? 1 : 2 };
    })
    .filter((x): x is { f: FoodItem; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.f.name.localeCompare(b.f.name))
    .slice(0, limit)
    .map((x) => x.f);
}
