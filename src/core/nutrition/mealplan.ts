/**
 * Generador de días de alimentación: arma desayuno, almuerzo, merienda y cena (y colación si
 * hace falta) con comidas argentinas simples, ajustando las porciones a las calorías y proteína
 * del objetivo. Puro y determinista (misma semilla → mismo día) para poder testearlo.
 *
 * Cómo ajusta: cada comida tiene un alimento "proteico" y uno "de energía" (carbohidrato); se
 * resuelve un sistema 2×2 para que la comida llegue a sus calorías y proteína, con límites para
 * que las porciones sigan siendo razonables. El resto (verduras, condimentos) queda fijo.
 */
import type { FoodItem, MacroTotals, MealType } from '../../types/domain.ts';
import { macrosFor } from './log.ts';

export type Role = 'protein' | 'carb' | 'fixed';

export interface TemplateItem {
  food: string;
  grams: number;
  role: Role;
  /** Unidad para mostrar (si el alimento la tiene): "unidad", "rebanada"… */
  unit?: string;
  /** Tope propio del multiplicador (p. ej. legumbres: un plato razonable, aunque falte proteína). */
  max?: number;
}

/** Restricciones que puede tener una comida. */
export type Flag = 'meat' | 'fish' | 'egg' | 'dairy' | 'gluten' | 'nuts' | 'sweet';

export interface MealTemplate {
  id: string;
  title: string;
  meals: MealType[];
  flags: Flag[];
  items: TemplateItem[];
}

const BS: MealType[] = ['breakfast', 'snack'];
const S: MealType[] = ['snack', 'extra'];
const LD: MealType[] = ['lunch', 'dinner'];

export const MEAL_TEMPLATES: MealTemplate[] = [
  // ── Desayunos y meriendas ──
  {
    id: 'cafe-tostadas-untable',
    title: 'Café con leche y tostadas integrales con queso untable',
    meals: BS,
    flags: ['dairy', 'gluten'],
    items: [
      { food: 'leche-parcial', grams: 200, role: 'fixed', unit: 'vaso' },
      { food: 'cafe', grams: 150, role: 'fixed', unit: 'taza' },
      { food: 'pan-lactal-integral', grams: 54, role: 'carb', unit: 'rebanada' },
      { food: 'queso-untable-light', grams: 30, role: 'protein', unit: 'cucharada' },
    ],
  },
  {
    id: 'yogur-avena-banana',
    title: 'Yogur griego con avena y banana',
    meals: BS,
    flags: ['dairy', 'gluten'],
    items: [
      { food: 'yogur-griego', grams: 160, role: 'protein' },
      { food: 'avena', grams: 30, role: 'carb', unit: 'cucharada' },
      { food: 'banana', grams: 120, role: 'fixed', unit: 'unidad' },
    ],
  },
  {
    id: 'huevos-tostadas-tomate',
    title: 'Huevos revueltos con tostadas y tomate',
    meals: BS,
    flags: ['egg', 'gluten'],
    items: [
      { food: 'huevo-entero', grams: 100, role: 'protein', unit: 'unidad' },
      { food: 'pan-lactal-integral', grams: 54, role: 'carb', unit: 'rebanada' },
      { food: 'tomate', grams: 120, role: 'fixed' },
      { food: 'cafe', grams: 150, role: 'fixed', unit: 'taza' },
    ],
  },
  {
    id: 'mate-galletas-queso',
    title: 'Mate con galletas de arroz, queso y mandarina',
    meals: BS,
    flags: ['dairy'],
    items: [
      { food: 'mate-amargo', grams: 300, role: 'fixed', unit: 'mate' },
      { food: 'galletas-arroz', grams: 27, role: 'carb', unit: 'unidad' },
      { food: 'queso-cremoso', grams: 30, role: 'protein', unit: 'feta' },
      { food: 'mandarina', grams: 90, role: 'fixed', unit: 'unidad' },
    ],
  },
  {
    id: 'licuado-banana-avena',
    title: 'Licuado de banana con leche y avena',
    meals: BS,
    flags: ['dairy', 'gluten'],
    items: [
      { food: 'leche-descremada', grams: 250, role: 'protein' },
      { food: 'banana', grams: 120, role: 'carb' },
      { food: 'avena', grams: 20, role: 'fixed', unit: 'cucharada' },
    ],
  },
  {
    id: 'tostadas-mani-banana',
    title: 'Tostadas con pasta de maní y banana',
    meals: BS,
    flags: ['gluten', 'nuts'],
    items: [
      { food: 'pan-lactal-integral', grams: 54, role: 'carb', unit: 'rebanada' },
      { food: 'pasta-mani', grams: 16, role: 'protein', unit: 'cucharada' },
      { food: 'banana', grams: 120, role: 'fixed', unit: 'unidad' },
      { food: 'mate-amargo', grams: 300, role: 'fixed', unit: 'mate' },
    ],
  },
  {
    id: 'galletas-mani-manzana',
    title: 'Galletas de arroz con pasta de maní y manzana',
    meals: BS,
    flags: ['nuts'],
    items: [
      { food: 'galletas-arroz', grams: 27, role: 'carb', unit: 'unidad' },
      { food: 'pasta-mani', grams: 16, role: 'protein', unit: 'cucharada' },
      { food: 'manzana', grams: 180, role: 'fixed', unit: 'unidad' },
    ],
  },
  {
    id: 'tostadas-ricota-mermelada',
    title: 'Tostadas con ricota y mermelada',
    meals: BS,
    flags: ['dairy', 'gluten', 'sweet'],
    items: [
      { food: 'pan-frances', grams: 40, role: 'carb', unit: 'mignon' },
      { food: 'ricota-descremada', grams: 60, role: 'protein', unit: 'cucharada' },
      { food: 'mermelada', grams: 20, role: 'fixed', unit: 'cucharada' },
      { food: 'cafe', grams: 150, role: 'fixed', unit: 'taza' },
    ],
  },
  {
    id: 'yogur-frutillas',
    title: 'Yogur griego con frutillas',
    meals: S,
    flags: ['dairy'],
    items: [
      { food: 'yogur-griego', grams: 160, role: 'protein' },
      { food: 'frutilla', grams: 150, role: 'carb' },
    ],
  },
  {
    id: 'fruta-almendras',
    title: 'Fruta con almendras',
    meals: S,
    flags: ['nuts'],
    items: [
      { food: 'manzana', grams: 180, role: 'carb' },
      { food: 'almendras', grams: 20, role: 'protein' },
    ],
  },
  {
    id: 'huevo-duro-fruta',
    title: 'Huevo duro con fruta',
    meals: S,
    flags: ['egg'],
    items: [
      { food: 'huevo-duro', grams: 50, role: 'protein', unit: 'unidad' },
      { food: 'pera', grams: 170, role: 'carb' },
    ],
  },
  {
    id: 'garbanzos-crocantes-fruta',
    title: 'Fruta con maní tostado',
    meals: S,
    flags: ['nuts'],
    items: [
      { food: 'naranja', grams: 180, role: 'carb' },
      { food: 'mani-tostado', grams: 20, role: 'protein' },
    ],
  },

  // ── Almuerzos y cenas ──
  {
    id: 'pollo-arroz-ensalada',
    title: 'Pollo a la plancha con arroz y ensalada',
    meals: LD,
    flags: ['meat'],
    items: [
      { food: 'pollo-pechuga-cocida', grams: 150, role: 'protein' },
      { food: 'arroz-blanco-cocido', grams: 150, role: 'carb' },
      { food: 'lechuga', grams: 60, role: 'fixed' },
      { food: 'tomate', grams: 120, role: 'fixed' },
      { food: 'aceite', grams: 10, role: 'fixed' },
    ],
  },
  {
    id: 'carne-pure-calabaza',
    title: 'Carne magra con puré de papa y calabaza',
    meals: LD,
    flags: ['meat'],
    items: [
      { food: 'vaca-magra-cocida', grams: 130, role: 'protein' },
      { food: 'papa-hervida', grams: 150, role: 'carb' },
      { food: 'zapallo-anco-cocido', grams: 150, role: 'fixed' },
      { food: 'aceite', grams: 5, role: 'fixed' },
    ],
  },
  {
    id: 'merluza-batata-brocoli',
    title: 'Merluza al horno con batata y brócoli',
    meals: LD,
    flags: ['fish'],
    items: [
      { food: 'merluza-cocida', grams: 180, role: 'protein' },
      { food: 'batata-horno', grams: 180, role: 'carb' },
      { food: 'brocoli-hervido', grams: 150, role: 'fixed' },
      { food: 'aceite', grams: 10, role: 'fixed' },
    ],
  },
  {
    id: 'milanesa-pollo-ensalada',
    title: 'Milanesa de pollo al horno con papas y ensalada',
    meals: LD,
    flags: ['meat', 'gluten'],
    items: [
      { food: 'milanesa-pollo-horno', grams: 140, role: 'protein', unit: 'unidad' },
      { food: 'papa-hervida', grams: 120, role: 'carb' },
      { food: 'lechuga', grams: 60, role: 'fixed' },
      { food: 'tomate', grams: 120, role: 'fixed' },
      { food: 'aceite', grams: 5, role: 'fixed' },
    ],
  },
  {
    id: 'fideos-bolognesa',
    title: 'Fideos con salsa de carne picada',
    meals: LD,
    flags: ['meat', 'gluten', 'dairy'],
    items: [
      { food: 'vaca-picada-especial-cocida', grams: 100, role: 'protein' },
      { food: 'fideos-cocidos', grams: 200, role: 'carb' },
      { food: 'tomate', grams: 150, role: 'fixed' },
      { food: 'cebolla', grams: 50, role: 'fixed' },
      { food: 'queso-rallado', grams: 10, role: 'fixed', unit: 'cucharada' },
    ],
  },
  {
    id: 'lentejas-arroz',
    title: 'Guiso de lentejas con arroz integral y verduras',
    meals: LD,
    flags: [],
    items: [
      { food: 'lentejas-cocidas', grams: 200, role: 'protein', max: 1.6 },
      { food: 'arroz-integral-cocido', grams: 120, role: 'carb' },
      { food: 'zanahoria', grams: 70, role: 'fixed' },
      { food: 'cebolla', grams: 50, role: 'fixed' },
      { food: 'aceite', grams: 5, role: 'fixed' },
    ],
  },
  {
    id: 'tortilla-papa-ensalada',
    title: 'Tortilla de papa con ensalada',
    meals: LD,
    flags: ['egg'],
    items: [
      { food: 'huevo-entero', grams: 150, role: 'protein', unit: 'unidad' },
      { food: 'papa-hervida', grams: 200, role: 'carb' },
      { food: 'lechuga', grams: 60, role: 'fixed' },
      { food: 'tomate', grams: 120, role: 'fixed' },
      { food: 'aceite', grams: 10, role: 'fixed' },
    ],
  },
  {
    id: 'ensalada-atun-huevo-papa',
    title: 'Ensalada completa de atún, huevo y papa',
    meals: LD,
    flags: ['fish', 'egg'],
    items: [
      { food: 'atun-natural', grams: 120, role: 'protein', unit: 'lata' },
      { food: 'papa-hervida', grams: 150, role: 'carb' },
      { food: 'huevo-duro', grams: 50, role: 'fixed', unit: 'unidad' },
      { food: 'tomate', grams: 120, role: 'fixed' },
      { food: 'lechuga', grams: 60, role: 'fixed' },
      { food: 'aceite', grams: 5, role: 'fixed' },
    ],
  },
  {
    id: 'garbanzos-salteados-arroz',
    title: 'Garbanzos salteados con verduras y arroz',
    meals: LD,
    flags: [],
    items: [
      { food: 'garbanzos-cocidos', grams: 180, role: 'protein', max: 1.7 },
      { food: 'arroz-blanco-cocido', grams: 120, role: 'carb' },
      { food: 'morron', grams: 100, role: 'fixed' },
      { food: 'zapallito', grams: 150, role: 'fixed' },
      { food: 'aceite', grams: 10, role: 'fixed' },
    ],
  },
  {
    id: 'muslo-calabaza-choclo',
    title: 'Pollo al horno con calabaza y choclo',
    meals: LD,
    flags: ['meat'],
    items: [
      { food: 'pollo-muslo-cocido', grams: 150, role: 'protein', unit: 'unidad' },
      { food: 'choclo-cocido', grams: 100, role: 'carb', unit: 'unidad' },
      { food: 'zapallo-anco-cocido', grams: 150, role: 'fixed' },
      { food: 'aceite', grams: 5, role: 'fixed' },
    ],
  },
  {
    id: 'bowl-porotos-palta',
    title: 'Bowl de porotos negros, arroz y palta',
    meals: LD,
    flags: [],
    items: [
      { food: 'porotos-negros-cocidos', grams: 180, role: 'protein', max: 1.7 },
      { food: 'arroz-blanco-cocido', grams: 120, role: 'carb' },
      { food: 'palta', grams: 50, role: 'fixed' },
      { food: 'tomate', grams: 100, role: 'fixed' },
    ],
  },
  {
    id: 'revuelto-zapallitos-arroz',
    title: 'Revuelto de zapallitos con huevo y arroz',
    meals: LD,
    flags: ['egg'],
    items: [
      { food: 'huevo-entero', grams: 100, role: 'protein', unit: 'unidad' },
      { food: 'arroz-blanco-cocido', grams: 150, role: 'carb' },
      { food: 'zapallito', grams: 200, role: 'fixed' },
      { food: 'cebolla', grams: 50, role: 'fixed' },
      { food: 'aceite', grams: 5, role: 'fixed' },
    ],
  },
  {
    id: 'carne-ensalada-choclo',
    title: 'Bife magro con ensalada de tomate y choclo',
    meals: LD,
    flags: ['meat'],
    items: [
      { food: 'vaca-magra-cocida', grams: 130, role: 'protein' },
      { food: 'choclo-cocido', grams: 100, role: 'carb' },
      { food: 'papa-hervida', grams: 100, role: 'fixed' },
      { food: 'tomate', grams: 150, role: 'fixed' },
      { food: 'aceite', grams: 10, role: 'fixed' },
    ],
  },
];

/** Restricciones del perfil → banderas que no pueden aparecer. */
export const RESTRICTION_FLAGS: Record<string, Flag[]> = {
  Vegetariana: ['meat', 'fish'],
  Vegana: ['meat', 'fish', 'egg', 'dairy'],
  Pescetariana: ['meat'],
  'Sin TACC (celiaquía)': ['gluten'],
  'Sin lactosa': ['dairy'],
  'Sin frutos secos': ['nuts'],
  'Sin huevo': ['egg'],
  Diabetes: ['sweet'],
};

export function bannedFlags(preferences: readonly string[], restrictions: readonly string[]): Set<Flag> {
  const out = new Set<Flag>();
  for (const k of [...preferences, ...restrictions]) for (const f of RESTRICTION_FLAGS[k] ?? []) out.add(f);
  return out;
}

export function eligibleTemplates(meal: MealType, banned: Set<Flag>): MealTemplate[] {
  return MEAL_TEMPLATES.filter((t) => t.meals.includes(meal) && !t.flags.some((f) => banned.has(f)));
}

// ───────── Distribución del día ─────────

export interface DayTargets {
  kcal: number;
  protein: number;
}

/** Reparto de calorías y proteína por comida. Con objetivos altos se suma una colación. */
export function mealSplit(kcal: number): { meal: MealType; kcal: number; protein: number }[] {
  const base: [MealType, number, number][] =
    kcal > 2600
      ? [
          ['breakfast', 0.22, 0.2],
          ['lunch', 0.3, 0.3],
          ['snack', 0.13, 0.13],
          ['dinner', 0.27, 0.27],
          ['extra', 0.08, 0.1],
        ]
      : [
          ['breakfast', 0.25, 0.22],
          ['lunch', 0.33, 0.32],
          ['snack', 0.12, 0.14],
          ['dinner', 0.3, 0.32],
        ];
  return base.map(([meal, k, p]) => ({ meal, kcal: k, protein: p }));
}

// ───────── Ajuste de porciones ─────────

export interface PlanItem {
  food_item_id: string;
  quantity: number;
  unit: string;
  grams: number;
}

export interface PlannedMeal {
  meal_type: MealType;
  template_id: string;
  title: string;
  items: PlanItem[];
  /** Ya se cargó al registro de comidas. */
  logged: boolean;
}

type Lookup = (id: string) => FoodItem | undefined;

const LIMITS: Record<Role, [number, number]> = { protein: [0.4, 2.5], carb: [0.25, 2.2], fixed: [0.6, 1.8] };

/** Solo los acompañamientos con energía se agrandan o achican (no el café, el mate ni la lechuga). */
const scalesWithMeal = (f: FoodItem) => f.kcal >= 60;

function macrosAt(food: FoodItem, grams: number): MacroTotals {
  return macrosFor(food, Math.max(1, grams), food.is_liquid ? 'ml' : 'g');
}

/** Redondeo amigable: unidades enteras (o medias para pan) si el alimento las tiene; si no, de a 5 g. */
export function toDisplay(food: FoodItem, grams: number, unit?: string): PlanItem {
  const per = unit ? food.portions[unit] : undefined;
  if (per) {
    const step = /rebanada|cucharada|mate|feta|unidad/.test(unit!) && per <= 40 ? 1 : 0.5;
    const q = Math.max(step, Math.round(grams / per / step) * step);
    return { food_item_id: food.id, quantity: q, unit: unit!, grams: Math.round(q * per) };
  }
  const g = Math.max(5, Math.round(grams / 5) * 5);
  return { food_item_id: food.id, quantity: g, unit: food.is_liquid ? 'ml' : 'g', grams: g };
}

/**
 * Ajusta una plantilla a las calorías y proteína de la comida con tres palancas: el alimento
 * proteico (a), el de energía (b) y, si eso no alcanza, el resto de la comida (s).
 */
export function fitTemplate(t: MealTemplate, target: DayTargets, find: Lookup): PlanItem[] {
  const rows = t.items.map((it) => ({ it, food: find(it.food) })).filter((r): r is { it: TemplateItem; food: FoodItem } => !!r.food);
  const sum = (role: Role, key: keyof MacroTotals) => rows.filter((r) => r.it.role === role).reduce((acc, r) => acc + macrosAt(r.food, r.it.grams)[key], 0);
  const sumFixed = (key: keyof MacroTotals, scalable: boolean) =>
    rows.filter((r) => r.it.role === 'fixed' && scalesWithMeal(r.food) === scalable).reduce((acc, r) => acc + macrosAt(r.food, r.it.grams)[key], 0);
  const [pk, pp, ck, cp] = [sum('protein', 'kcal'), sum('protein', 'protein'), sum('carb', 'kcal'), sum('carb', 'protein')];
  // Parte fija que no escala (verduras, infusiones) y parte que escala con s.
  const [nk, np, fk, fp] = [sumFixed('kcal', false), sumFixed('protein', false), sumFixed('kcal', true), sumFixed('protein', true)];
  const K = Math.max(0, target.kcal - nk);
  const P = Math.max(0, target.protein - np);
  const roleMax = (r: Role) => Math.min(LIMITS[r][1], ...rows.filter((x) => x.it.role === r && x.it.max).map((x) => x.it.max!));
  const clamp = (v: number, r: Role) => Math.min(roleMax(r), Math.max(LIMITS[r][0], Number.isFinite(v) ? v : 1));

  let a = 1;
  let b = 1;
  let s = 1;
  for (let i = 0; i < 6; i++) {
    a = pp > 0 ? clamp((P - b * cp - s * fp) / pp, 'protein') : 1;
    b = ck > 0 ? clamp((K - a * pk - s * fk) / ck, 'carb') : 1;
    const atBound = ck === 0 || b === LIMITS.carb[0] || b === roleMax('carb');
    if (atBound && fk > 0) s = clamp((K - a * pk - b * ck) / fk, 'fixed');
  }
  // Si no se puede cumplir todo, mandan las calorías: se resigna proteína antes que pasarse.
  const kcalAt = () => a * pk + b * ck + s * fk;
  if (kcalAt() > K * 1.06 && pk > 0) a = clamp((K * 1.06 - b * ck - s * fk) / pk, 'protein');
  if (kcalAt() > K * 1.06 && fk > 0) s = clamp((K * 1.06 - a * pk - b * ck) / fk, 'fixed');
  return rows.map(({ it, food }) => toDisplay(food, it.grams * (it.role === 'protein' ? a : it.role === 'carb' ? b : scalesWithMeal(food) ? s : 1), it.unit));
}

export function mealTotals(items: readonly PlanItem[], find: Lookup): MacroTotals {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const i of items) {
    const f = find(i.food_item_id);
    if (!f) continue;
    const m = macrosFor(f, i.quantity, i.unit);
    t.kcal += m.kcal;
    t.protein += m.protein;
    t.carbs += m.carbs;
    t.fat += m.fat;
  }
  return { kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
}

// ───────── Generación ─────────

/** PRNG determinista (mulberry32) a partir de un texto. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenerateOptions {
  targets: DayTargets;
  preferences: readonly string[];
  restrictions: readonly string[];
  seed: string;
  /** Plantillas usadas el día anterior por comida (para no repetir). */
  previous?: Partial<Record<MealType, string>>;
}

export class NoTemplatesError extends Error {
  constructor(meal: MealType) {
    super(`No hay comidas compatibles con tus restricciones para ${meal}.`);
  }
}

function pick(list: MealTemplate[], avoid: Set<string>, rand: () => number): MealTemplate {
  const fresh = list.filter((t) => !avoid.has(t.id));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(rand() * pool.length)]!;
}

export function generateMealDay(opts: GenerateOptions, find: Lookup): PlannedMeal[] {
  const banned = bannedFlags(opts.preferences, opts.restrictions);
  const rand = rng(opts.seed);
  const usedToday = new Set<string>();
  const split = mealSplit(opts.targets.kcal);
  const chosen = split.map(({ meal, kcal, protein }) => {
    const list = eligibleTemplates(meal, banned);
    if (!list.length) throw new NoTemplatesError(meal);
    const avoid = new Set(usedToday);
    const prev = opts.previous?.[meal];
    if (prev) avoid.add(prev);
    const t = pick(list, avoid, rand);
    usedToday.add(t.id);
    return { t, meal, target: { kcal: opts.targets.kcal * kcal, protein: opts.targets.protein * protein } };
  });
  let day = chosen.map(({ t, meal, target }) => ({ meal_type: meal, template_id: t.id, title: t.title, items: fitTemplate(t, target, find), logged: false }));

  // Corrección del día: lo que les faltó o sobró a las comidas chicas lo absorben almuerzo y cena.
  for (let pass = 0; pass < 2; pass++) {
    const tot = day.reduce((acc, m) => {
      const x = mealTotals(m.items, find);
      return { kcal: acc.kcal + x.kcal, protein: acc.protein + x.protein };
    }, { kcal: 0, protein: 0 });
    const dk = opts.targets.kcal - tot.kcal;
    const dp = opts.targets.protein - tot.protein;
    if (Math.abs(dk) < opts.targets.kcal * 0.04 && dp < opts.targets.protein * 0.06) break;
    day = day.map((m, i) => {
      if (m.meal_type !== 'lunch' && m.meal_type !== 'dinner') return m;
      const cur = mealTotals(m.items, find);
      const c = chosen[i]!;
      return { ...m, items: fitTemplate(c.t, { kcal: Math.max(150, cur.kcal + dk / 2), protein: Math.max(10, cur.protein + Math.max(0, dp) / 2) }, find) };
    });
  }
  return day;
}

/** Cambia una comida por otra compatible distinta (y distinta de las otras del día). */
export function swapMeal(day: readonly PlannedMeal[], index: number, opts: Omit<GenerateOptions, 'previous'>, find: Lookup): PlannedMeal[] {
  const cur = day[index];
  if (!cur) return [...day];
  const banned = bannedFlags(opts.preferences, opts.restrictions);
  const list = eligibleTemplates(cur.meal_type, banned);
  const avoid = new Set(day.map((m) => m.template_id));
  const t = pick(list, avoid, rng(`${opts.seed}:${cur.template_id}:${index}`));
  const share = mealSplit(opts.targets.kcal).find((s) => s.meal === cur.meal_type) ?? { kcal: 0.25, protein: 0.25 };
  const items = fitTemplate(t, { kcal: opts.targets.kcal * share.kcal, protein: opts.targets.protein * share.protein }, find);
  return day.map((m, i) => (i === index ? { meal_type: m.meal_type, template_id: t.id, title: t.title, items, logged: false } : m));
}
