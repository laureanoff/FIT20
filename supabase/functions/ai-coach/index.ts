// Edge Function: asistente IA OPCIONAL.
// La app funciona completa sin esto: el plan lo genera un motor determinístico local.
// La clave del proveedor vive solo en los secrets de Supabase (AI_API_KEY); nunca en el frontend.
// Si no está configurada responde 503 y la UI muestra "Asistente no disponible".
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SYSTEM = `Sos el asistente de FIT 20, una app de entrenamiento, running y nutrición. Respondés en español rioplatense, breve y concreto.
Reglas: no diagnosticás lesiones ni enfermedades; ante dolor, lesión, mareos o síntomas recomendás consultar a un profesional de la salud.
No proponés dietas extremas, déficits mayores a 500 kcal diarias ni ayunos prolongados. Tus sugerencias de entrenamiento respetan
progresión gradual (≤10% semanal en running), descanso y el nivel de la persona. Aclarás que las estimaciones son aproximadas.
No inferís porcentaje de grasa corporal ni hacés juicios sobre el cuerpo de la persona.`;

const TASKS = new Set(['weekly_summary', 'progress_analysis', 'training_adjustment', 'exercise_alternatives', 'nutrition_review', 'menu_ideas', 'question']);
const MAX_INPUT_CHARS = 12_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  const apiKey = Deno.env.get('AI_API_KEY');
  const model = Deno.env.get('AI_MODEL') ?? 'claude-haiku-5-5';
  if (!apiKey) return json(503, { error: 'Asistente no configurado' });

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: 'Sesión inválida' });

  const body = await req.json().catch(() => null) as { task?: string; context?: unknown; question?: string } | null;
  if (!body?.task || !TASKS.has(body.task)) return json(400, { error: 'Tarea inválida' });
  const payload = JSON.stringify({ task: body.task, context: body.context ?? null, question: (body.question ?? '').slice(0, 1000) });
  if (payload.length > MAX_INPUT_CHARS) return json(413, { error: 'Contexto demasiado grande' });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 800, system: SYSTEM, messages: [{ role: 'user', content: payload }] }),
  });
  if (!res.ok) return json(502, { error: 'El asistente no respondió. Probá más tarde.' });
  const data = await res.json();
  const text = (data.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n');
  return json(200, { text });
});
