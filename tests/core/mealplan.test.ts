import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOODS, getFood } from '../../src/data/foods/index.ts';
import { MEAL_TEMPLATES, RESTRICTION_FLAGS, bannedFlags, eligibleTemplates, generateMealDay, mealSplit, mealTotals, swapMeal } from '../../src/core/nutrition/mealplan.ts';
import type { MealType } from '../../src/types/domain.ts';

const find = (id: string) => getFood(id);
const MEALS: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner', 'extra'];

function dayTotals(day: ReturnType<typeof generateMealDay>) {
  return day.reduce((a, m) => {
    const t = mealTotals(m.items, find);
    return { kcal: a.kcal + t.kcal, protein: a.protein + t.protein };
  }, { kcal: 0, protein: 0 });
}

test('plan de comidas: todas las plantillas usan alimentos y unidades existentes', () => {
  assert.equal(new Set(MEAL_TEMPLATES.map((t) => t.id)).size, MEAL_TEMPLATES.length);
  for (const t of MEAL_TEMPLATES) {
    assert.ok(t.items.some((i) => i.role === 'protein'), `${t.id} sin proteína`);
    for (const i of t.items) {
      const f = getFood(i.food);
      assert.ok(f, `${t.id}: falta ${i.food}`);
      if (i.unit) assert.ok(f!.portions[i.unit], `${t.id}: ${i.food} sin porción "${i.unit}"`);
    }
  }
});

test('plan de comidas: cada restricción deja al menos una opción por comida', () => {
  for (const r of Object.keys(RESTRICTION_FLAGS)) {
    const banned = bannedFlags([r], []);
    for (const m of ['breakfast', 'lunch', 'snack', 'dinner'] as MealType[]) assert.ok(eligibleTemplates(m, banned).length >= 2, `${r} · ${m}`);
  }
  // Combinación exigente: vegana + sin TACC
  const hard = bannedFlags(['Vegana'], ['Sin TACC (celiaquía)']);
  for (const m of ['breakfast', 'lunch', 'snack', 'dinner'] as MealType[]) assert.ok(eligibleTemplates(m, hard).length >= 1, `vegana sin TACC · ${m}`);
});

test('plan de comidas: llega a las calorías y proteína del objetivo (±12 %)', () => {
  const cases = [
    { kcal: 1700, protein: 120 },
    { kcal: 2200, protein: 150 },
    { kcal: 2900, protein: 170 },
  ];
  for (const targets of cases) {
    for (let d = 0; d < 14; d++) {
      const day = generateMealDay({ targets, preferences: [], restrictions: [], seed: `u:2026-11-${d}` }, find);
      const t = dayTotals(day);
      assert.ok(Math.abs(t.kcal - targets.kcal) / targets.kcal < 0.12, `kcal ${t.kcal} vs ${targets.kcal}`);
      assert.ok(t.protein >= targets.protein * 0.85, `proteína ${t.protein} vs ${targets.protein}`);
    }
  }
});

test('plan de comidas: respeta restricciones, no repite comidas en el día y es determinista', () => {
  const opts = { targets: { kcal: 2000, protein: 110 }, preferences: ['Vegetariana'], restrictions: ['Sin TACC (celiaquía)'], seed: 'x:2026-11-05' };
  const day = generateMealDay(opts, find);
  const banned = bannedFlags(opts.preferences, opts.restrictions);
  for (const m of day) {
    const t = MEAL_TEMPLATES.find((x) => x.id === m.template_id)!;
    assert.ok(!t.flags.some((f) => banned.has(f)), `${t.id} viola restricciones`);
  }
  assert.equal(new Set(day.map((m) => m.template_id)).size, day.length);
  assert.deepEqual(generateMealDay(opts, find), day);
  assert.ok(day.every((m) => m.items.every((i) => i.quantity > 0 && i.grams > 0)));
});

test('plan de comidas: colación solo con objetivos altos y cambiar una comida da otra distinta', () => {
  assert.equal(mealSplit(2000).length, 4);
  assert.equal(mealSplit(3000).at(-1)!.meal, 'extra');
  assert.ok(Math.abs(mealSplit(3000).reduce((a, s) => a + s.kcal, 0) - 1) < 1e-9);
  const opts = { targets: { kcal: 2000, protein: 130 }, preferences: [], restrictions: [], seed: 's' };
  const day = generateMealDay(opts, find);
  const swapped = swapMeal(day, 1, opts, find);
  assert.notEqual(swapped[1]!.template_id, day[1]!.template_id);
  assert.equal(swapped[0], day[0]);
  assert.ok(MEALS.includes(swapped[1]!.meal_type));
  assert.ok(FOODS.length > 0);
});
