/**
 * Notificación "en vivo" durante una salida de cardio, enviada por el servidor cada 1, 2 o 5 minutos.
 * Llega aunque el iPhone congele la app con el celu bloqueado (y sin cortar la música).
 * Con el celu bloqueado el GPS de una app web se pausa: se muestra lo medido hasta ese momento
 * y una estimación con tu ritmo, marcada con "≈".
 */

export type LiveActivity = 'run' | 'walk' | 'bike';

export interface LiveState {
  activity: LiveActivity;
  status: 'running' | 'paused';
  /** Tiempo de actividad (sin pausas) en el momento de `updated_at`. */
  elapsed_s: number;
  updated_at: string;
  distance_km: number;
  /** Ritmo medio en s/km (null si todavía no hay dato). */
  pace_s_per_km: number | null;
  target_km: number | null;
}

export interface LiveMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const LABEL: Record<LiveActivity, string> = { run: 'Running', walk: 'Caminata', bike: 'Bici' };
/** Más de esto sin noticias del teléfono: la estimación deja de tener sentido. */
const MAX_ESTIMATE_S = 45 * 60;

export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const km = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function rate(a: LiveActivity, pace: number): string {
  if (a === 'bike') return `${(3600 / pace).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km/h`;
  const s = Math.round(pace);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/km`;
}

/** Tiempo de actividad ahora (en pausa no avanza). */
export function liveElapsed(s: LiveState, now: Date): number {
  if (s.status !== 'running') return s.elapsed_s;
  const since = Math.max(0, (now.getTime() - new Date(s.updated_at).getTime()) / 1000);
  return s.elapsed_s + since;
}

export function composeLive(s: LiveState, now: Date): LiveMessage {
  const elapsed = liveElapsed(s, now);
  const since = s.status === 'running' ? elapsed - s.elapsed_s : 0;
  const plausible = s.pace_s_per_km !== null && s.pace_s_per_km > 0 && s.pace_s_per_km < 3600;
  // Sin GPS (celu bloqueado) por más de 1 min: estimación con el ritmo medio.
  const estimating = s.status === 'running' && plausible && since > 60 && since <= MAX_ESTIMATE_S;
  const dist = estimating ? s.distance_km + since / s.pace_s_per_km! : s.distance_km;
  const target = s.target_km ? ` de ${km(s.target_km).replace(/,00$/, '')}` : '';

  const head = s.status === 'paused' ? `${LABEL[s.activity]} en pausa` : LABEL[s.activity];
  const title = `${head} · ${clock(elapsed)} · ${estimating ? '≈' : ''}${km(dist)} km${target}`;

  const parts: string[] = [];
  if (estimating) parts.push(`${km(s.distance_km)} km medidos al bloquear; el resto, estimado con tu ritmo`);
  if (plausible) parts.push(s.activity === 'bike' ? `Velocidad media ${rate(s.activity, s.pace_s_per_km!)}` : `Ritmo medio ${rate(s.activity, s.pace_s_per_km!)}`);
  if (s.status === 'paused') parts.push('Tocá para reanudar');
  else if (!estimating && since > MAX_ESTIMATE_S) parts.push('Desbloqueá para actualizar la distancia');

  return { title, body: parts.join(' · ') || 'Salida en curso', url: '/running/en-curso', tag: 'fit20-live' };
}

/** ¿Toca mandar otra? Corriendo: según el intervalo. En pausa: una sola vez (no insistir). */
export function liveDue(nextAt: string | null, now: Date): boolean {
  return !!nextAt && new Date(nextAt).getTime() <= now.getTime();
}
