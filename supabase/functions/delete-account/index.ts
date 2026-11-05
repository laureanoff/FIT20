// Edge Function: elimina la cuenta del usuario autenticado y TODOS sus datos.
// La service_role key solo existe acá (variable de entorno de Supabase), nunca en el frontend.
// Las tablas tienen ON DELETE CASCADE hacia auth.users; las fotos se borran del bucket explícitamente.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1) Identificar al usuario con SU token (no se acepta un id enviado por el cliente).
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return json(401, { error: 'Sesión inválida' });

  // 2) Confirmación explícita.
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== 'ELIMINAR') return json(400, { error: 'Falta la confirmación' });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // 3) Fotos privadas del usuario.
  const prefix = `${user.id}/`;
  for (;;) {
    const { data: files, error: listErr } = await admin.storage.from('progress-photos').list(user.id, { limit: 100 });
    if (listErr) return json(500, { error: 'No se pudieron listar las fotos' });
    if (!files?.length) break;
    const { error: rmErr } = await admin.storage.from('progress-photos').remove(files.map((f) => prefix + f.name));
    if (rmErr) return json(500, { error: 'No se pudieron borrar las fotos' });
  }

  // 4) Usuario (cascada sobre todas sus tablas).
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return json(500, { error: 'No se pudo eliminar la cuenta' });

  return json(200, { ok: true });
});
