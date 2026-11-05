/**
 * Genera la migración de catálogo (ejercicios + alimentos) a partir de los datos TypeScript.
 * Una sola fuente de verdad: la app offline y la base en la nube usan exactamente los mismos datos.
 *
 *   npm run seed:generate
 *
 * Es una MIGRACIÓN (no seed.sql) porque `supabase db push` no ejecuta seed.sql en proyectos remotos.
 * Es idempotente: upsert por id, se puede reaplicar al actualizar el catálogo.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EXERCISES } from '../src/data/exercises/index.ts';
import { FOODS } from '../src/data/foods/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length ? `array[${v.map(lit).join(', ')}]::text[]` : `'{}'::text[]`;
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const exCols = ['id', 'name', 'primary_muscle', 'secondary_muscles', 'pattern', 'type', 'difficulty', 'equipment', 'description', 'steps', 'common_mistakes', 'safety', 'easier', 'harder', 'stress_regions', 'timed', 'unilateral'] as const;
const exRows = EXERCISES.map((e) => `  (${exCols.map((c) => lit(c === 'timed' || c === 'unilateral' ? (e[c] ?? false) : e[c])).join(', ')})`);

const foodCols = ['id', 'name', 'category', 'state', 'kcal', 'protein', 'carbs', 'fat', 'portions', 'is_liquid'] as const;
const foodRows = FOODS.map((f) => `  (${foodCols.map((c) => lit(f[c] ?? false)).join(', ')})`);

const updateSet = (cols: readonly string[]) => cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');

const sql = `-- ═══════════════════════════════════════════════════════════════════
-- FIT 20 · 003 · Catálogo inicial (GENERADO por scripts/generate-seed.ts — no editar a mano)
-- ${EXERCISES.length} ejercicios · ${FOODS.length} alimentos (valores aproximados por 100 g/ml)
-- ═══════════════════════════════════════════════════════════════════

insert into public.exercises (${exCols.join(', ')}) values
${exRows.join(',\n')}
on conflict (id) do update set ${updateSet(exCols)};

insert into public.food_items (${foodCols.join(', ')}) values
${foodRows.join(',\n')}
on conflict (id) do update set ${updateSet(foodCols)};
`;

const out = join(root, 'supabase/migrations/20261105000300_seed_catalog.sql');
writeFileSync(out, sql);
writeFileSync(
  join(root, 'supabase/seed.sql'),
  '-- El catálogo de ejercicios y alimentos está en la migración 20261105000300_seed_catalog.sql\n-- (las migraciones se aplican también en proyectos remotos; seed.sql solo en desarrollo local).\n-- No se cargan datos de usuarios de demostración: FIT 20 no mezcla datos ficticios con datos reales.\n',
);
console.log(`OK: ${EXERCISES.length} ejercicios, ${FOODS.length} alimentos → ${out}`);
