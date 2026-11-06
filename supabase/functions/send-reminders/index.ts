// Edge Function: avisos push de FIT 20.
//  · Cada 15 min la llama pg_cron (header x-cron-secret): manda el aviso de la mañana (sesión de hoy + clima)
//    y el de la noche (si la sesión sigue pendiente) a quien le toque según su hora local.
//  · Con el token de un usuario y { mode: "test" }: le manda ya el aviso de hoy a sus dispositivos.
// Las claves VAPID y el secreto del cron se leen de Supabase Vault con la service_role (nunca llegan al navegador).
// core/ es una copia de src/core (scripts/sync-function-core.mjs); un test verifica que estén iguales.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { composeReminder, isDue, localParts, type DayInfo, type Message, type ReminderKind } from './core/notify/compose.ts';
import { forecastAt, openMeteoUrl, parseOpenMeteo, type Forecast } from './core/weather/weather.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface Prefs {
  user_id: string;
  morning_enabled: boolean;
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  include_weather: boolean;
  timezone: string;
  lat: number | null;
  lon: number | null;
  last_morning_date: string | null;
  last_evening_date: string | null;
  forecast: Forecast | null;
  forecast_at: string | null;
}
interface Sub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failures: number;
}

const SITE = Deno.env.get('SITE_URL') ?? 'https://fit20.vercel.app';

async function loadConfig(admin: SupabaseClient) {
  const { data, error } = await admin.rpc('push_config').single<{ vapid_public: string; vapid_private: string; cron_secret: string }>();
  if (error || !data?.vapid_private) throw new Error('Falta la configuración de notificaciones');
  webpush.setVapidDetails(SITE, data.vapid_public, data.vapid_private);
  return data;
}

function validTz(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'America/Argentina/Buenos_Aires';
  }
}

/** Sesión del plan activo para esa fecha (o null si no hay plan o no hay día). */
async function dayFor(admin: SupabaseClient, userId: string, date: string): Promise<DayInfo | null> {
  const { data: plans } = await admin.from('training_plans').select('id').eq('user_id', userId).eq('status', 'active').is('deleted_at', null);
  if (!plans?.length) return null;
  const { data: days } = await admin
    .from('training_days')
    .select('id, session_type, status, planned')
    .eq('user_id', userId)
    .eq('date', date)
    .is('deleted_at', null)
    .in('plan_id', plans.map((p) => p.id))
    .limit(1);
  const d = days?.[0];
  if (!d) return null;
  const p = (d.planned ?? {}) as { title?: string; estimated_minutes?: number; run?: { activity?: 'run' | 'walk' | 'bike'; distance_km?: number } | null };
  return {
    id: d.id,
    session_type: d.session_type,
    status: d.status,
    title: p.title ?? 'Entrenamiento',
    estimated_minutes: p.estimated_minutes ?? 0,
    run_activity: p.run ? (p.run.activity ?? 'run') : null,
    run_distance_km: p.run?.distance_km ?? null,
  };
}

const forecasts = new Map<string, Promise<Forecast | null>>();
function forecastFor(lat: number | null, lon: number | null): Promise<Forecast | null> {
  if (lat === null || lon === null) return Promise.resolve(null);
  // La instancia puede seguir viva entre corridas: el pronóstico se reusa solo dentro de la misma hora.
  const key = `${lat},${lon},${new Date().toISOString().slice(0, 13)}`;
  if (!forecasts.has(key)) {
    forecasts.set(
      key,
      fetch(openMeteoUrl(Number(lat), Number(lon), 2))
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j ? parseOpenMeteo(j) : null))
        .catch(() => null),
    );
  }
  return forecasts.get(key)!;
}

/** Pronóstico en vivo; si Open-Meteo no responde, el último que guardó el teléfono (si cubre esta hora). */
async function weatherFor(p: Prefs | null, date: string, time: string): Promise<Forecast | null> {
  const live = await forecastFor(p?.lat ?? null, p?.lon ?? null);
  if (live) return live;
  if (!p?.forecast || !p.forecast_at || Date.now() - new Date(p.forecast_at).getTime() > 36 * 60 * 60 * 1000) return null;
  return forecastAt(p.forecast, `${date}T${time.slice(0, 2)}`);
}

/** Manda a todos los dispositivos del usuario; borra las suscripciones vencidas. Devuelve cuántos recibieron. */
async function deliver(admin: SupabaseClient, userId: string, msg: Message): Promise<number> {
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth, failures').eq('user_id', userId);
  let ok = 0;
  await Promise.all(
    ((subs ?? []) as Sub[]).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 6 * 60 * 60, urgency: 'normal', topic: msg.tag.slice(0, 32) });
        ok++;
        await admin.from('push_subscriptions').update({ failures: 0, last_success_at: new Date().toISOString() }).eq('id', s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0;
        if (status === 404 || status === 410 || s.failures >= 9) await admin.from('push_subscriptions').delete().eq('id', s.id);
        else await admin.from('push_subscriptions').update({ failures: s.failures + 1 }).eq('id', s.id);
        console.error('push falló', status, (e as Error).message);
      }
    }),
  );
  return ok;
}

async function runSchedule(admin: SupabaseClient, now: Date) {
  const { data: prefs, error } = await admin.from('notification_prefs').select('*').or('morning_enabled.eq.true,evening_enabled.eq.true');
  if (error) throw error;
  let sent = 0;
  let checked = 0;
  for (const p of (prefs ?? []) as Prefs[]) {
    const { date, time } = localParts(now, validTz(p.timezone));
    const kinds: ReminderKind[] = [];
    if (p.morning_enabled && isDue(time, p.morning_time.slice(0, 5), date, p.last_morning_date)) kinds.push('morning');
    if (p.evening_enabled && isDue(time, p.evening_time.slice(0, 5), date, p.last_evening_date)) kinds.push('evening');
    if (!kinds.length) continue;
    checked++;
    // Marcar primero: si dos corridas se pisan, nadie recibe el aviso dos veces.
    const mark = Object.fromEntries(kinds.map((k) => [k === 'morning' ? 'last_morning_date' : 'last_evening_date', date]));
    await admin.from('notification_prefs').update(mark).eq('user_id', p.user_id);
    const day = await dayFor(admin, p.user_id, date);
    for (const kind of kinds) {
      const fc = p.include_weather && kind === 'morning' ? await weatherFor(p, date, time) : null;
      const msg = composeReminder(kind, day, fc, p.include_weather);
      if (msg) sent += await deliver(admin, p.user_id, msg);
    }
  }
  return { checked, sent };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let config;
  try {
    config = await loadConfig(admin);
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }

  // 1) Llamada programada.
  const cronHeader = req.headers.get('x-cron-secret');
  if (cronHeader) {
    if (cronHeader !== config.cron_secret) return json(401, { error: 'No autorizado' });
    try {
      return json(200, await runSchedule(admin, new Date()));
    } catch (e) {
      console.error(e);
      return json(500, { error: 'Falló el envío programado' });
    }
  }

  // 2) Prueba pedida por el usuario desde la app.
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: 'Sesión inválida' });
  const body = await req.json().catch(() => ({}));
  if (body?.mode !== 'test') return json(400, { error: 'Pedido inválido' });

  const { data: p } = await admin.from('notification_prefs').select('*').eq('user_id', user.id).maybeSingle<Prefs>();
  const tz = validTz(p?.timezone ?? body.timezone ?? 'America/Argentina/Buenos_Aires');
  const { date, time } = localParts(new Date(), tz);
  const day = await dayFor(admin, user.id, date);
  const includeWeather = p?.include_weather ?? true;
  const fc = includeWeather ? await weatherFor(p ?? null, date, time) : null;
  const msg: Message = composeReminder('morning', day, fc, includeWeather) ?? {
    title: 'FIT 20',
    body: day?.status === 'completed' ? '¡Ya entrenaste hoy! Así te van a llegar los avisos.' : 'Así te van a llegar los avisos.',
    url: '/',
    tag: 'fit20-test',
  };
  const delivered = await deliver(admin, user.id, { ...msg, tag: 'fit20-test' });
  return json(200, { delivered, message: msg });
});
