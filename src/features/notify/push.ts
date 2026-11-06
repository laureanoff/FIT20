import { supabase } from '@/lib/supabase';
import { getWeatherState, subscribeWeather } from '@/features/weather/store';
import { trimForecast } from '@/core/weather/weather';

/**
 * Notificaciones push: alta y baja del dispositivo, y preferencias (hora de los avisos, clima).
 * Requiere internet para activarlas; después llegan aunque la app esté cerrada.
 */

const VAPID_PUBLIC = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? 'BKK9vw9DeV8nY0KmyZtuPFZCog24znTbLhod3jkfGdHaMvp9a_Ei_SrsDBw3x1WRsaK6y2v7Mo5dbR-liySBXI8';

export interface NotificationPrefs {
  morning_enabled: boolean;
  morning_time: string; // "HH:MM"
  evening_enabled: boolean;
  evening_time: string;
  include_weather: boolean;
  timezone: string;
  lat: number | null;
  lon: number | null;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  morning_enabled: true,
  morning_time: '07:30',
  evening_enabled: false,
  evening_time: '20:00',
  include_weather: true,
  timezone: 'America/Argentina/Buenos_Aires',
  lat: null,
  lon: null,
};

export type PushSupport = 'ok' | 'ios-needs-install' | 'unsupported' | 'dev';

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (import.meta.env.DEV) return 'dev';
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIos() && !isStandalone()) return 'ios-needs-install'; // Safari solo permite push en la app instalada
  return has ? 'ok' : 'unsupported';
}

export function permission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const localTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_PREFS.timezone;
  } catch {
    return DEFAULT_PREFS.timezone;
  }
};

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : isIos() ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Linux';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${br} · ${os}`;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('La app todavía se está instalando. Probá de nuevo en unos segundos.')), 10000)),
  ]);
  return reg;
}

/** Suscripción de este dispositivo (null si no está activada). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  try {
    return await (await registration()).pushManager.getSubscription();
  } catch {
    return null;
  }
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('El navegador devolvió una suscripción incompleta');
  const { error } = await supabase!.rpc('register_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_device: deviceLabel() });
  if (error) throw new Error('No se pudo guardar el dispositivo. Revisá la conexión.');
}

/** Pide permiso, suscribe este dispositivo y crea las preferencias si no existían. */
export async function enablePush(): Promise<void> {
  if (!supabase) throw new Error('Falta configurar el servidor');
  if (!navigator.onLine) throw new Error('Necesitás internet para activar las notificaciones.');
  const support = pushSupport();
  if (support === 'ios-needs-install') throw new Error('En iPhone, primero agregá FIT 20 a la pantalla de inicio (Compartir → Agregar a inicio) y abrila desde ahí.');
  if (support !== 'ok') throw new Error('Este navegador no permite notificaciones push.');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Las notificaciones están bloqueadas para este sitio: habilitalas en los ajustes del navegador.' : 'No se dio permiso para las notificaciones.');

  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC) });
  await saveSubscription(sub);

  const existing = await loadPrefs();
  await savePrefs({ ...(existing ?? DEFAULT_PREFS), timezone: localTimezone(), ...coordsPatch() });
}

/** Da de baja solo este dispositivo (los demás siguen recibiendo). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

export async function loadPrefs(): Promise<NotificationPrefs | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('morning_enabled, morning_time, evening_enabled, evening_time, include_weather, timezone, lat, lon')
    .maybeSingle();
  if (error) throw new Error('No se pudieron cargar tus avisos. Revisá la conexión.');
  if (!data) return null;
  return {
    ...data,
    morning_time: String(data.morning_time).slice(0, 5),
    evening_time: String(data.evening_time).slice(0, 5),
    lat: data.lat === null ? null : Number(data.lat),
    lon: data.lon === null ? null : Number(data.lon),
  } as NotificationPrefs;
}

export async function savePrefs(p: NotificationPrefs): Promise<void> {
  if (!supabase) return;
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Sesión vencida: volvé a entrar.');
  const { error } = await supabase.from('notification_prefs').upsert({ user_id: u.user.id, ...p, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error('No se pudieron guardar tus avisos. Revisá la conexión.');
}

function coordsPatch(): Partial<NotificationPrefs> {
  const c = getWeatherState().coords;
  return c ? { lat: c.lat, lon: c.lon } : {};
}

/** Manda ya el aviso de hoy a todos tus dispositivos. */
export async function sendTest(): Promise<{ delivered: number }> {
  if (!supabase) throw new Error('Falta configurar el servidor');
  const { data, error } = await supabase.functions.invoke('send-reminders', { body: { mode: 'test', timezone: localTimezone() } });
  if (error) throw new Error('No se pudo enviar la prueba. Revisá la conexión.');
  return data as { delivered: number };
}

// ───────── Mantenimiento en segundo plano ─────────

const ON_KEY = 'fit20:push-on';
export const markPushOn = (on: boolean) => {
  try {
    if (on) localStorage.setItem(ON_KEY, '1');
    else localStorage.removeItem(ON_KEY);
  } catch {
    /* opcional */
  }
};
const pushOn = () => {
  try {
    return localStorage.getItem(ON_KEY) === '1';
  } catch {
    return false;
  }
};

let started = false;
/**
 * Con los avisos activos: mantiene al día la ubicación del pronóstico y la zona horaria,
 * y vuelve a registrar el dispositivo si el navegador renovó la suscripción.
 */
export function startPushMaintenance(): void {
  if (started || typeof window === 'undefined' || !supabase) return;
  started = true;
  let lastKey = '';
  const syncPrefs = async () => {
    if (!pushOn() || !navigator.onLine) return;
    const c = getWeatherState().coords;
    const key = `${c?.lat},${c?.lon},${localTimezone()}`;
    if (key === lastKey) return;
    try {
      const p = await loadPrefs();
      if (!p) return;
      if (p.lat !== (c?.lat ?? p.lat) || p.lon !== (c?.lon ?? p.lon) || p.timezone !== localTimezone()) await savePrefs({ ...p, timezone: localTimezone(), ...coordsPatch() });
      lastKey = key;
    } catch {
      /* se reintenta en el próximo cambio */
    }
  };
  // Respaldo del pronóstico para el aviso de la mañana (si Open-Meteo no le responde al servidor).
  let lastForecast = '';
  let lastUpload = 0;
  const uploadForecast = async () => {
    const f = getWeatherState().forecast;
    if (!f || !pushOn() || !navigator.onLine || f.fetchedAt === lastForecast || Date.now() - lastUpload < 2 * 60 * 60 * 1000) return;
    lastForecast = f.fetchedAt;
    lastUpload = Date.now();
    try {
      const { data: u } = await supabase!.auth.getUser();
      if (u.user) await supabase!.from('notification_prefs').update({ forecast: trimForecast(f), forecast_at: f.fetchedAt }).eq('user_id', u.user.id);
    } catch {
      lastUpload = 0;
    }
  };

  subscribeWeather(() => {
    void syncPrefs();
    void uploadForecast();
  });
  window.addEventListener('online', () => void syncPrefs());
  setTimeout(() => {
    void syncPrefs();
    void uploadForecast();
  }, 3000);

  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
    if ((e.data as { type?: string })?.type !== 'fit20:push-resubscribe' || !pushOn()) return;
    void (async () => {
      const reg = await registration();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC) }));
      await saveSubscription(sub);
    })().catch(() => undefined);
  });
}
