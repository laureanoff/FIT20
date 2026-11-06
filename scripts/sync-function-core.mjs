// Copia la lógica pura que usa la Edge Function send-reminders (Deno no ve src/).
// Uso: node scripts/sync-function-core.mjs   — tests/core verifica que las copias estén al día.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const FUNCTION_CORE = ['notify/compose.ts', 'weather/weather.ts'];

for (const f of FUNCTION_CORE) {
  const to = `supabase/functions/send-reminders/core/${f}`;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(`src/core/${f}`, to);
  console.log(`src/core/${f} → ${to}`);
}
