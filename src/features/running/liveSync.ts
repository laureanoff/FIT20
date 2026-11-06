/**
 * Informa al servidor cómo va la salida (tiempo, distancia, ritmo) para que mande la notificación
 * en vivo cada 1, 2 o 5 minutos, aunque el iPhone congele la app con el celu bloqueado.
 * Usa fetch con keepalive: el último aviso sale aunque la pantalla se apague justo después.
 */
import { supabase } from '@/lib/supabase';

export type LiveInterval = 0 | 1 | 2 | 5;
const KEY = 'fit20:live-interval';

export function liveInterval(): LiveInterval {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v === 1 || v === 2 || v === 5 ? v : 0;
  } catch {
    return 0;
  }
}
export function setLiveInterval(v: LiveInterval): void {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* nada */
  }
}

export interface LiveSnapshot {
  activity: 'run' | 'walk' | 'bike';
  status: 'running' | 'paused';
  elapsed_s: number;
  distance_km: number;
  pace_s_per_km: number | null;
  target_km: number | null;
}

let token: { access: string; uid: string } | null = null;
if (supabase) {
  void supabase.auth.getSession().then(({ data }) => {
    if (data.session) token = { access: data.session.access_token, uid: data.session.user.id };
  });
  supabase.auth.onAuthStateChange((_e, s) => {
    token = s ? { access: s.access_token, uid: s.user.id } : null;
  });
}

const base = () => (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const key = () => (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

/** Fila a guardar. `schedule`: cuándo mandar la próxima notificación (undefined = no tocar). */
export function liveRow(s: LiveSnapshot, uid: string, interval: LiveInterval, now: Date, schedule?: 'next' | 'none') {
  const row: Record<string, unknown> = {
    user_id: uid,
    activity: s.activity,
    status: s.status,
    elapsed_s: Math.max(0, Math.min(86400, Math.round(s.elapsed_s))),
    updated_at: now.toISOString(),
    distance_km: Math.max(0, Math.min(1000, Math.round(s.distance_km * 1000) / 1000)),
    pace_s_per_km: s.pace_s_per_km && s.pace_s_per_km >= 30 && s.pace_s_per_km <= 3600 ? Math.round(s.pace_s_per_km * 10) / 10 : null,
    target_km: s.target_km,
    interval_min: interval || 2,
  };
  if (schedule === 'next') row.next_push_at = new Date(now.getTime() + (interval || 2) * 60_000 - 20_000).toISOString(); // margen: el envío corre cada minuto en punto
  if (schedule === 'none') row.next_push_at = null;
  return row;
}

/** Envía el estado. Devuelve false sin sesión o sin conexión (la salida sigue igual en el teléfono). */
export async function sendLive(s: LiveSnapshot, interval: LiveInterval, schedule?: 'next' | 'none'): Promise<boolean> {
  if (!token || !base() || !navigator.onLine || !interval) return false;
  try {
    const res = await fetch(`${base()}/rest/v1/live_sessions?on_conflict=user_id`, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: key(),
        Authorization: `Bearer ${token.access}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(liveRow(s, token.uid, interval, new Date(), schedule)),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Termina la notificación en vivo (al guardar o descartar la salida). */
export async function endLive(): Promise<void> {
  if (!token || !base()) return;
  try {
    await fetch(`${base()}/rest/v1/live_sessions?user_id=eq.${token.uid}`, {
      method: 'DELETE',
      keepalive: true,
      headers: { apikey: key(), Authorization: `Bearer ${token.access}` },
    });
  } catch {
    /* si no hay conexión, el servidor la descarta solo a las 6 h */
  }
}

/** Manda ya una notificación de ejemplo a tus dispositivos. */
export async function testLive(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.functions.invoke('send-reminders', { body: { mode: 'live-test' } });
  if (error) throw new Error('No se pudo enviar la prueba. Revisá la conexión.');
  return (data as { delivered: number }).delivered;
}
