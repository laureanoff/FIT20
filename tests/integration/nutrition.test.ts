import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Fit20DB, alive } from '@/lib/db/database';
import type { Ctx } from '@/features/training/actions';
import {
  addFood,
  addSavedMeal,
  addWater,
  cookingPair,
  createCustomFood,
  customFoods,
  frequentFoods,
  logFromFood,
  mealForHour,
  removeFoodLog,
  resolveTargets,
  saveMeal,
  totalsOf,
  updateFoodLog,
} from '@/features/nutrition/actions';
import { getFood } from '@/data/foods';

const UID = '66666666-6666-4666-8666-666666666666';
let db: Fit20DB;
let ctx: Ctx;
beforeEach(async () => {
  db = new Fit20DB(`${UID}-${Math.random()}`);
  await db.open();
  ctx = { db, userId: UID, changed: () => {} };
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const arrozCrudo = getFood('arroz-blanco-crudo')!;

describe('registro de comidas', () => {
  it('guarda un snapshot con macros y se puede editar y borrar', async () => {
    await addFood(ctx, arrozCrudo, 80, 'g', '2026-11-05', 'lunch');
    const [log] = await db.food_logs.toArray();
    expect(log!.food_name).toBe('Arroz blanco (crudo)');
    expect(log!.calories).toBe(Math.round((arrozCrudo.kcal * 80) / 100));
    expect(log!.grams).toBe(80);

    await updateFoodLog(ctx, log!, arrozCrudo, 100, 'g', 'dinner');
    const edited = (await db.food_logs.get(log!.id))!;
    expect(edited.meal_type).toBe('dinner');
    expect(edited.logged_at).toBe(log!.logged_at);
    expect(await db.outbox.count()).toBe(1); // creación + edición sin subir = una sola operación

    await removeFoodLog(ctx, edited);
    expect(alive(await db.food_logs.get(log!.id))).toBe(false);
  });

  it('respeta los límites del servidor', () => {
    expect(() => logFromFood(UID, arrozCrudo, 6000, 'g', '2026-11-05', 'lunch')).toThrow(/5 kg/);
    expect(() => logFromFood(UID, arrozCrudo, 0, 'g', '2026-11-05', 'lunch')).toThrow();
  });

  it('suma totales del día', () => {
    expect(totalsOf([
      { calories: 100, protein: 10.04, carbohydrates: 5, fats: 1.06 },
      { calories: 250.6, protein: 2, carbohydrates: 30, fats: 9 },
    ])).toEqual({ kcal: 351, protein: 12, carbs: 35, fat: 10.1 });
  });

  it('crudo ↔ cocido usa el rendimiento de cocción', () => {
    const p = cookingPair(arrozCrudo)!;
    expect(p.other.id).toBe('arroz-blanco-cocido');
    expect(p.yieldFactor).toBe(2.8);
    expect(cookingPair(getFood('arroz-blanco-cocido')!)!.other.id).toBe('arroz-blanco-crudo');
  });
});

describe('alimentos propios, comidas guardadas y agua', () => {
  it('crea un alimento propio válido y rechaza etiquetas incoherentes', async () => {
    const id = await createCustomFood(ctx, { name: 'Barrita', brand: 'X', kcal: 380, protein: 8, carbs: 65, fat: 10, portion_name: 'Unidad', portion_grams: 25, is_liquid: false });
    expect(id).toMatch(/^custom-[a-z0-9-]+$/);
    const mine = await customFoods(db, UID);
    expect(mine[0]!.portions).toEqual({ unidad: 25 });
    await expect(createCustomFood(ctx, { name: 'Mal', brand: '', kcal: 900, protein: 1, carbs: 1, fat: 1, portion_name: '', portion_grams: null, is_liquid: false })).rejects.toThrow(/no coinciden/);
  });

  it('guarda una comida y la vuelve a cargar en otro día', async () => {
    await addFood(ctx, arrozCrudo, 80, 'g', '2026-11-04', 'lunch');
    await addFood(ctx, getFood('pollo-pechuga-cocida')!, 1, 'porción', '2026-11-04', 'lunch');
    await saveMeal(ctx, 'Almuerzo de siempre', await db.food_logs.toArray());
    const [meal] = await db.saved_meals.toArray();
    expect(meal!.items).toHaveLength(2);
    expect(await addSavedMeal(ctx, meal!, [], '2026-11-05', 'dinner')).toEqual([]);
    expect(await db.food_logs.where('log_date').equals('2026-11-05').count()).toBe(2);
  });

  it('registra agua dentro del rango permitido', async () => {
    await addWater(ctx, 250, '2026-11-05');
    await expect(addWater(ctx, 0, '2026-11-05')).rejects.toThrow();
    expect(await db.water_logs.count()).toBe(1);
  });

  it('frecuentes: ordena por uso y sugiere la última porción', () => {
    const r = frequentFoods([
      { food_item_id: 'a', quantity: 1, unit: 'unidad', logged_at: '2026-11-01T10:00:00Z' },
      { food_item_id: 'b', quantity: 100, unit: 'g', logged_at: '2026-11-02T10:00:00Z' },
      { food_item_id: 'a', quantity: 2, unit: 'unidad', logged_at: '2026-11-03T10:00:00Z' },
    ]);
    expect(r[0]).toEqual({ food_item_id: 'a', quantity: 2, unit: 'unidad', count: 2 });
  });
});

describe('objetivos', () => {
  const energy = { status: 'ok' as const, bmr: 1700, tdee: 2400, target_kcal: 2200, target_range: null, protein_g: 150, fat_g: 70, carbs_g: 240, water_ml: 2900, activity_factor: 1.4, notes: [] };
  it('usa la estimación si no hay objetivo propio', () => {
    expect(resolveTargets(null, energy)).toMatchObject({ kcal: 2200, protein: 150, custom: false });
  });
  it('prioriza el objetivo propio', () => {
    expect(resolveTargets({ kcal: 1900, protein: 140, carbs: 180, fat: 60 }, energy)).toMatchObject({ kcal: 1900, water_ml: 2900, custom: true });
  });
  it('sugiere la comida según la hora', () => {
    expect(mealForHour(8)).toBe('breakfast');
    expect(mealForHour(13)).toBe('lunch');
    expect(mealForHour(17)).toBe('snack');
    expect(mealForHour(21)).toBe('dinner');
  });
});

describe('plan de alimentación', () => {
  const pc = {
    targets: { kcal: 2200, protein: 150, carbs: 240, fat: 70, water_ml: 2800, custom: false },
    profile: { dietary_preferences: ['Vegetariana'], dietary_restrictions: [] },
    custom: [],
  };

  it('arma la semana con ids estables y "Lo comí" carga el registro', async () => {
    const { generateWeek, logPlannedMeal, planDayId, swapPlannedMeal, isOutdated } = await import('@/features/nutrition/mealPlanActions');
    await generateWeek(ctx, pc, '2026-11-05', 7);
    const days = await db.meal_plan_days.orderBy('plan_date').toArray();
    expect(days).toHaveLength(7);
    expect(days[0]!.id).toBe(await planDayId(UID, '2026-11-05'));
    // Vegetariano: ninguna comida con carne ni pescado.
    const ids = days.flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.food_item_id)));
    expect(ids.some((i) => /pollo|vaca|merluza|atun|milanesa|cerdo/.test(i))).toBe(false);

    const day = days[0]!;
    await logPlannedMeal(ctx, pc, day, 0);
    const after = (await db.meal_plan_days.get(day.id))!;
    expect(after.meals[0]!.logged).toBe(true);
    expect(await db.food_logs.where('log_date').equals('2026-11-05').count()).toBe(day.meals[0]!.items.length);

    // Rearmar la semana no pisa el día con comidas ya cargadas.
    await generateWeek(ctx, pc, '2026-11-05', 7, ':otra');
    expect((await db.meal_plan_days.get(day.id))!.meals[0]!.logged).toBe(true);

    await swapPlannedMeal(ctx, pc, after, 1);
    expect((await db.meal_plan_days.get(day.id))!.meals[1]!.template_id).not.toBe(after.meals[1]!.template_id);
    expect(isOutdated(after, { ...pc.targets, kcal: 1800 })).toBe(true);
  });
});
