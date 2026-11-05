import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, getExercise, isAvailable } from '../../src/data/exercises/index.ts';
import { FOODS } from '../../src/data/foods/index.ts';

test('biblioteca: al menos 80 ejercicios con ids únicos', () => {
  assert.ok(EXERCISES.length >= 80, `hay ${EXERCISES.length}`);
  assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
});

test('biblioteca: cubre las 14 categorías pedidas', () => {
  const cats = new Set(EXERCISES.map((e) => e.primary_muscle));
  for (const c of ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'abs', 'quads', 'hamstrings', 'glutes', 'calves', 'full_body', 'mobility', 'stretching', 'cardio']) {
    assert.ok(cats.has(c as never), `falta categoría ${c}`);
  }
});

test('biblioteca: cada ejercicio tiene datos completos y variantes válidas', () => {
  for (const e of EXERCISES) {
    assert.ok(e.name.length > 3, e.id);
    assert.ok(e.description.length > 20, `${e.id}: descripción`);
    assert.ok(e.steps.length >= 2, `${e.id}: pasos`);
    assert.ok(e.common_mistakes.length >= 1, `${e.id}: errores frecuentes`);
    assert.ok(e.safety.length >= 1, `${e.id}: seguridad`);
    assert.ok(e.equipment.length >= 1, `${e.id}: equipamiento`);
    assert.ok(/^[a-z0-9-]+$/.test(e.id), `${e.id}: slug`);
    for (const v of [...e.easier, ...e.harder]) assert.ok(getExercise(v), `${e.id} referencia variante inexistente ${v}`);
  }
});

test('biblioteca: incluye peso corporal, mancuernas, bandas, mochila y máquinas', () => {
  for (const eq of ['bodyweight', 'dumbbells', 'bands', 'weighted_backpack', 'gym'] as const) {
    assert.ok(EXERCISES.filter((e) => e.equipment.includes(eq)).length >= 5, eq);
  }
});

test('equipamiento: gimnasio cubre mancuernas/bandas/barra; peso corporal siempre disponible', () => {
  assert.ok(isAvailable(getExercise('db-row')!, ['gym']));
  assert.ok(isAvailable(getExercise('pull-up')!, ['gym']));
  assert.ok(isAvailable(getExercise('push-up')!, []));
  assert.ok(!isAvailable(getExercise('db-row')!, ['bands']));
});

test('alimentos: ids únicos y energía consistente con los macros', () => {
  assert.equal(new Set(FOODS.map((f) => f.id)).size, FOODS.length);
  const alcohol = new Set(['cerveza', 'vino']);
  for (const f of FOODS) {
    if (f.kcal < 20 || alcohol.has(f.id)) continue;
    const est = 4 * f.protein + 4 * f.carbs + 9 * f.fat;
    const err = Math.abs(est - f.kcal) / f.kcal;
    // Vegetales: la fibra cuenta como carbohidrato pero aporta ~2 kcal/g → mayor tolerancia.
    assert.ok(err < (f.kcal < 60 ? 0.3 : 0.2), `${f.id}: ${f.kcal} kcal vs ${est.toFixed(0)} calculadas`);
  }
});

test('alimentos: diferencia crudo y cocido en los básicos argentinos', () => {
  const pairs = [['arroz-blanco-crudo', 'arroz-blanco-cocido'], ['fideos-crudos', 'fideos-cocidos'], ['pollo-pechuga-cruda', 'pollo-pechuga-cocida'], ['vaca-magra-cruda', 'vaca-magra-cocida'], ['lentejas-crudas', 'lentejas-cocidas'], ['papa-cruda', 'papa-hervida']];
  for (const [raw, cooked] of pairs) {
    const r = FOODS.find((f) => f.id === raw);
    const c = FOODS.find((f) => f.id === cooked);
    assert.equal(r?.state, 'raw', raw);
    assert.equal(c?.state, 'cooked', cooked);
  }
  for (const cat of ['Carnes', 'Huevos', 'Cereales', 'Lácteos', 'Panes', 'Frutas', 'Verduras', 'Pescados', 'Legumbres', 'Frutos secos', 'Tubérculos']) {
    assert.ok(FOODS.some((f) => f.category === cat), cat);
  }
});
