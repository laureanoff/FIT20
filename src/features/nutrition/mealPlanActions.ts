import { type PlannedMeal, generateMealDay, swapMeal } from '@/core/nutrition/mealplan';
import { addDays } from '@/core/utils/date';
import { type L, type MealPlanDay, alive } from '@/lib/db/database';
import { type PendingWrite, saveRecords } from '@/lib/db/repository';
import { type Ctx, stableId } from '@/features/training/actions';
import type { FoodItem, MealType, Profile } from '@/types/domain';
import { findFood, logFromFood, type Targets } from './actions';

export const PLAN_DAYS = 7;

export interface PlanContext {
  targets: Targets;
  profile: Pick<Profile, 'dietary_preferences' | 'dietary_restrictions'>;
  custom: readonly FoodItem[];
}

const lookup = (custom: readonly FoodItem[]) => (id: string) => findFood(id, custom);

/** Un registro por día con id estable: dos dispositivos que arman el mismo día editan el mismo registro. */
export function planDayId(userId: string, date: string): Promise<string> {
  return stableId(`mealplan:${userId}:${date}`);
}

function opts(ctx: Ctx, pc: PlanContext, date: string, salt = '') {
  return {
    targets: { kcal: pc.targets.kcal, protein: pc.targets.protein },
    preferences: pc.profile.dietary_preferences,
    restrictions: pc.profile.dietary_restrictions,
    seed: `${ctx.userId}:${date}${salt}`,
  };
}

async function save(ctx: Ctx, writes: PendingWrite[]): Promise<void> {
  if ((await saveRecords(ctx.db, writes)) > 0) ctx.changed();
}

/**
 * Arma (o rearma) los días desde `start`. Los días que ya tienen comidas cargadas al registro
 * no se tocan para no perder lo hecho.
 */
export async function generateWeek(ctx: Ctx, pc: PlanContext, start: string, days = PLAN_DAYS, salt = ''): Promise<void> {
  const writes: PendingWrite[] = [];
  let previous: Partial<Record<MealType, string>> = {};
  const prevDay = (await ctx.db.meal_plan_days.where('plan_date').equals(addDays(start, -1)).toArray()).find(alive);
  if (prevDay) previous = Object.fromEntries(prevDay.meals.map((m) => [m.meal_type, m.template_id]));
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const id = await planDayId(ctx.userId, date);
    const existing = await ctx.db.meal_plan_days.get(id);
    if (existing && !existing.deleted_at && existing.meals.some((m) => m.logged)) {
      previous = Object.fromEntries(existing.meals.map((m) => [m.meal_type, m.template_id]));
      continue;
    }
    const meals = generateMealDay({ ...opts(ctx, pc, date, salt), previous }, lookup(pc.custom));
    previous = Object.fromEntries(meals.map((m) => [m.meal_type, m.template_id]));
    const rec: Omit<MealPlanDay, 'version' | 'updated_at'> = { ...(existing ?? {}), id, user_id: ctx.userId, plan_date: date, meals, targets: { kcal: pc.targets.kcal, protein: pc.targets.protein, carbs: pc.targets.carbs, fat: pc.targets.fat }, deleted_at: null };
    writes.push({ entity: 'meal_plan_days', record: rec });
  }
  await save(ctx, writes);
}

/** Rearma un día (otra combinación), conservando las comidas que ya se cargaron al registro. */
export async function regenerateDay(ctx: Ctx, pc: PlanContext, day: L<MealPlanDay>): Promise<void> {
  const fresh = generateMealDay(opts(ctx, pc, day.plan_date, `:${Date.now()}`), lookup(pc.custom));
  const meals = fresh.map((m) => day.meals.find((x) => x.meal_type === m.meal_type && x.logged) ?? m);
  await save(ctx, [{ entity: 'meal_plan_days', record: { ...day, meals, targets: { kcal: pc.targets.kcal, protein: pc.targets.protein, carbs: pc.targets.carbs, fat: pc.targets.fat } } }]);
}

export async function swapPlannedMeal(ctx: Ctx, pc: PlanContext, day: L<MealPlanDay>, index: number): Promise<void> {
  const meals = swapMeal(day.meals, index, opts(ctx, pc, day.plan_date, `:${Date.now()}`), lookup(pc.custom));
  await save(ctx, [{ entity: 'meal_plan_days', record: { ...day, meals } }]);
}

/** "Lo comí": carga los alimentos de la comida al registro del día y la marca como hecha. */
export async function logPlannedMeal(ctx: Ctx, pc: PlanContext, day: L<MealPlanDay>, index: number): Promise<void> {
  const meal = day.meals[index];
  if (!meal || meal.logged) return;
  const find = lookup(pc.custom);
  const writes: PendingWrite[] = [];
  for (const it of meal.items) {
    const food = find(it.food_item_id);
    if (food) writes.push({ entity: 'food_logs', record: logFromFood(ctx.userId, food, it.quantity, it.unit, day.plan_date, meal.meal_type) });
  }
  const meals: PlannedMeal[] = day.meals.map((m, i) => (i === index ? { ...m, logged: true } : m));
  writes.push({ entity: 'meal_plan_days', record: { ...day, meals } });
  await save(ctx, writes);
}

/** ¿El plan guardado quedó desactualizado (cambió el objetivo de calorías o proteína)? */
export function isOutdated(day: Pick<MealPlanDay, 'targets'>, t: Targets): boolean {
  return Math.abs(day.targets.kcal - t.kcal) > 50 || Math.abs(day.targets.protein - t.protein) > 8;
}
