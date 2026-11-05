import { type EnergyResult } from '@/core/nutrition/energy';
import { macrosFor, validateCustomFood } from '@/core/nutrition/log';
import { COOKING_YIELD, FOODS, getFood } from '@/data/foods';
import { type CustomFood, type Fit20DB, type FoodLog, type L, type SavedMeal, type SavedMealItem, type WaterLog, alive } from '@/lib/db/database';
import { type PendingWrite, saveRecords } from '@/lib/db/repository';
import { newId } from '@/lib/id';
import type { Ctx } from '@/features/training/actions';
import type { FoodItem, MacroTotals, MealType } from '@/types/domain';

export const MEALS: { type: MealType; label: string }[] = [
  { type: 'breakfast', label: 'Desayuno' },
  { type: 'lunch', label: 'Almuerzo' },
  { type: 'snack', label: 'Merienda' },
  { type: 'dinner', label: 'Cena' },
  { type: 'extra', label: 'Colaciones' },
];
export const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Desayuno', lunch: 'Almuerzo', snack: 'Merienda', dinner: 'Cena', extra: 'Colaciones', drink: 'Bebidas' };

/** Comida sugerida según la hora (para preseleccionar al agregar). */
export function mealForHour(h: number): MealType {
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15.5) return 'lunch';
  if (h >= 15.5 && h < 19.5) return 'snack';
  if (h >= 19.5 || h < 1) return 'dinner';
  return 'extra';
}

async function write(ctx: Ctx, writes: PendingWrite[]): Promise<void> {
  if ((await saveRecords(ctx.db, writes)) > 0) ctx.changed();
}

// ───────── Alimentos ─────────

export function customToFood(c: CustomFood): FoodItem {
  return { id: c.id, name: c.brand ? `${c.name} (${c.brand})` : c.name, category: c.category, state: c.state, kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat, portions: c.portions ?? {}, is_liquid: c.is_liquid, user_id: c.owner_id };
}

/** Alimentos propios del usuario (la base global descargada del servidor se ignora: ya viene en la app). */
export async function customFoods(db: Fit20DB, userId: string): Promise<FoodItem[]> {
  return (await db.food_items.where('owner_id').equals(userId).toArray()).filter(alive).map(customToFood);
}

export function findFood(id: string, custom: readonly FoodItem[]): FoodItem | undefined {
  return getFood(id, custom);
}

export interface CustomFoodInput {
  name: string;
  brand: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  portion_name: string;
  portion_grams: number | null;
  is_liquid: boolean;
}

export async function createCustomFood(ctx: Ctx, input: CustomFoodInput): Promise<string> {
  const errors = validateCustomFood(input);
  if (errors.length) throw new Error(errors.join(' '));
  const id = `custom-${newId()}`;
  const portions: Record<string, number> = {};
  if (input.portion_name.trim() && input.portion_grams && input.portion_grams > 0) portions[input.portion_name.trim().toLowerCase()] = input.portion_grams;
  const food: Omit<CustomFood, 'version' | 'updated_at'> = {
    id,
    owner_id: ctx.userId,
    name: input.name.trim(),
    brand: input.brand.trim() || null,
    category: 'Personalizados',
    state: 'na',
    kcal: round1(input.kcal),
    protein: round1(input.protein),
    carbs: round1(input.carbs),
    fat: round1(input.fat),
    portions,
    is_liquid: input.is_liquid,
    deleted_at: null,
  };
  await write(ctx, [{ entity: 'food_items', record: food }]);
  return id;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Nombre que deja claro si el peso es crudo (p. ej. "Arroz blanco (crudo)"): confundirlo triplica el error. */
export function displayName(food: Pick<FoodItem, 'name' | 'state'>): string {
  if (food.state === 'raw' && !/crud|sec[oa]s?\b/i.test(food.name)) return `${food.name} (crudo)`;
  return food.name;
}

// ───────── Registros ─────────

export function logFromFood(userId: string, food: FoodItem, quantity: number, unit: string, date: string, meal: MealType, id = newId()): Omit<FoodLog, 'version' | 'updated_at'> {
  const m = macrosFor(food, quantity, unit);
  if (m.grams > 5000) throw new Error('La porción supera 5 kg: revisá la cantidad.');
  return {
    id,
    user_id: userId,
    food_item_id: food.id,
    log_date: date,
    meal_type: meal,
    quantity: Math.round(quantity * 100) / 100,
    unit,
    grams: m.grams,
    // Snapshot: si el alimento cambia después, el historial no se altera.
    food_name: displayName(food),
    calories: m.kcal,
    protein: m.protein,
    carbohydrates: m.carbs,
    fats: m.fat,
    logged_at: new Date().toISOString(),
    deleted_at: null,
  };
}

export async function addFood(ctx: Ctx, food: FoodItem, quantity: number, unit: string, date: string, meal: MealType): Promise<void> {
  await write(ctx, [{ entity: 'food_logs', record: logFromFood(ctx.userId, food, quantity, unit, date, meal) }]);
}

export async function updateFoodLog(ctx: Ctx, log: L<FoodLog>, food: FoodItem, quantity: number, unit: string, meal: MealType): Promise<void> {
  const next = logFromFood(ctx.userId, food, quantity, unit, log.log_date, meal, log.id);
  await write(ctx, [{ entity: 'food_logs', record: { ...log, ...next, logged_at: log.logged_at } }]);
}

export async function removeFoodLog(ctx: Ctx, log: L<FoodLog>): Promise<void> {
  await write(ctx, [{ entity: 'food_logs', record: { ...log, deleted_at: new Date().toISOString() } }]);
}

export function totalsOf(logs: readonly Pick<FoodLog, 'calories' | 'protein' | 'carbohydrates' | 'fats'>[]): MacroTotals {
  const t = logs.reduce((a, l) => ({ kcal: a.kcal + l.calories, protein: a.protein + l.protein, carbs: a.carbs + l.carbohydrates, fat: a.fat + l.fats }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  return { kcal: Math.round(t.kcal), protein: round1(t.protein), carbs: round1(t.carbs), fat: round1(t.fat) };
}

// ───────── Comidas guardadas ─────────

export async function saveMeal(ctx: Ctx, name: string, logs: readonly FoodLog[]): Promise<void> {
  const n = name.trim();
  if (n.length < 1 || n.length > 80) throw new Error('El nombre debe tener entre 1 y 80 caracteres.');
  const items: SavedMealItem[] = logs.slice(0, 40).map((l) => ({ food_item_id: l.food_item_id, quantity: l.quantity, unit: l.unit }));
  if (!items.length) throw new Error('La comida no tiene alimentos.');
  await write(ctx, [{ entity: 'saved_meals', record: { id: newId(), user_id: ctx.userId, name: n, items, deleted_at: null } satisfies Omit<SavedMeal, 'version' | 'updated_at'> }]);
}

/** Agrega todos los alimentos de una comida guardada. Devuelve los que ya no existen. */
export async function addSavedMeal(ctx: Ctx, meal: SavedMeal, custom: readonly FoodItem[], date: string, mealType: MealType): Promise<string[]> {
  const missing: string[] = [];
  const writes: PendingWrite[] = [];
  for (const it of meal.items) {
    const food = findFood(it.food_item_id, custom);
    if (!food) {
      missing.push(it.food_item_id);
      continue;
    }
    try {
      writes.push({ entity: 'food_logs', record: logFromFood(ctx.userId, food, it.quantity, it.unit, date, mealType) });
    } catch {
      missing.push(food.name);
    }
  }
  await write(ctx, writes);
  return missing;
}

export async function deleteSavedMeal(ctx: Ctx, meal: L<SavedMeal>): Promise<void> {
  await write(ctx, [{ entity: 'saved_meals', record: { ...meal, deleted_at: new Date().toISOString() } }]);
}

// ───────── Agua ─────────

export async function addWater(ctx: Ctx, ml: number, date: string): Promise<void> {
  if (!(ml >= 1 && ml <= 5000)) throw new Error('Entre 1 y 5000 ml.');
  await write(ctx, [{ entity: 'water_logs', record: { id: newId(), user_id: ctx.userId, log_date: date, quantity_ml: Math.round(ml), logged_at: new Date().toISOString(), deleted_at: null } satisfies Omit<WaterLog, 'version' | 'updated_at'> }]);
}

export async function removeWater(ctx: Ctx, w: L<WaterLog>): Promise<void> {
  await write(ctx, [{ entity: 'water_logs', record: { ...w, deleted_at: new Date().toISOString() } }]);
}

// ───────── Objetivos ─────────

export interface Targets extends MacroTotals {
  water_ml: number;
  /** true si el usuario los fijó a mano; false si son la estimación automática. */
  custom: boolean;
}

/** Objetivo diario: el que fijó el usuario o, si no, la estimación del perfil. */
export function resolveTargets(stored: Record<string, number> | null | undefined, energy: EnergyResult): Targets | null {
  const kcal = stored?.kcal;
  if (stored && kcal && kcal > 0) {
    return { kcal, protein: stored.protein ?? 0, carbs: stored.carbs ?? 0, fat: stored.fat ?? 0, water_ml: stored.water_ml ?? (energy.status === 'ok' ? energy.water_ml : 2000), custom: true };
  }
  if (energy.status !== 'ok') return null;
  return { kcal: energy.target_kcal, protein: energy.protein_g, carbs: energy.carbs_g, fat: energy.fat_g, water_ml: energy.water_ml, custom: false };
}

/** Alimentos que más usa la persona (para el acceso rápido al agregar). */
export function frequentFoods(logs: readonly Pick<FoodLog, 'food_item_id' | 'quantity' | 'unit' | 'logged_at'>[], limit = 12): { food_item_id: string; quantity: number; unit: string; count: number }[] {
  const m = new Map<string, { food_item_id: string; quantity: number; unit: string; count: number; last: string }>();
  for (const l of logs) {
    const cur = m.get(l.food_item_id);
    if (!cur) m.set(l.food_item_id, { food_item_id: l.food_item_id, quantity: l.quantity, unit: l.unit, count: 1, last: l.logged_at });
    else {
      cur.count++;
      // La porción sugerida es la última usada.
      if (l.logged_at > cur.last) Object.assign(cur, { quantity: l.quantity, unit: l.unit, last: l.logged_at });
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, limit).map(({ last: _l, ...r }) => r);
}

export const ALL_FOODS = FOODS;

/**
 * Versión cruda/cocida del mismo alimento y factor de rendimiento (peso cocido / crudo).
 * Ej.: 80 g de fideos secos ≈ 184 g cocidos.
 */
export function cookingPair(food: FoodItem): { other: FoodItem; yieldFactor: number } | null {
  const m = food.id.match(/^(.*)-(crud[oa]s?|cocid[oa]s?)$/);
  if (!m) return null;
  const base = m[1]!;
  const factor = COOKING_YIELD[base];
  if (!factor) return null;
  const other = FOODS.find((f) => f.id !== food.id && f.id.startsWith(`${base}-`) && /-(crud|cocid)/.test(f.id));
  return other ? { other, yieldFactor: factor } : null;
}
