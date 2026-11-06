/**
 * Texto de las notificaciones y cuándo corresponde mandarlas.
 * Puro: lo usa la función programada de Supabase (Deno) y lo prueban los tests del núcleo.
 */
import { adviceFor, bestHour, describeCode, fmtTemp, type AdviceActivity, type Forecast } from '../weather/weather.ts';

export type ReminderKind = 'morning' | 'evening';

export interface DayInfo {
  session_type: 'strength' | 'run' | 'strength_run' | 'active_recovery' | 'rest';
  status: 'pending' | 'started' | 'completed' | 'skipped';
  title: string;
  estimated_minutes: number;
  run_activity?: 'run' | 'walk' | 'bike' | null;
  run_distance_km?: number | null;
  id: string;
}

export interface Message {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** "HH:MM" → minutos desde la medianoche. */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * La función corre cada 15 minutos: un aviso vence si la hora local cayó en [objetivo, objetivo + ventana)
 * y todavía no se mandó hoy. Si una corrida falla, la siguiente dentro de la ventana lo recupera.
 */
export function isDue(localTime: string, target: string, localDate: string, lastSent: string | null, windowMin = 15): boolean {
  if (lastSent === localDate) return false;
  const now = toMinutes(localTime);
  const t = toMinutes(target);
  if (!Number.isFinite(now) || !Number.isFinite(t)) return false;
  return now >= t && now < t + windowMin;
}

/** Fecha y hora local en una zona horaria IANA, sin dependencias. */
export function localParts(at: Date, timeZone: string): { date: string; time: string } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const ACT: Record<'run' | 'walk' | 'bike', string> = { run: 'trote', walk: 'caminata', bike: 'bici' };

function activityFor(day: DayInfo): AdviceActivity {
  if (day.session_type === 'run' || day.session_type === 'strength_run') return day.run_activity ?? 'run';
  return 'strength';
}

/** Línea de clima para el aviso: "☀️ Despejado, 15° (máx 19°). Mejor hora: 18 h." + el consejo más importante. */
export function weatherLine(f: Forecast, activity: AdviceActivity): string {
  const today = f.days[0];
  const desc = describeCode(f.now.code).label;
  const parts = [`${desc}, ${fmtTemp(f.now.temp)}${today ? ` (máx ${fmtTemp(today.tMax)})` : ''}.`];
  const tip = adviceFor(activity, {
    temp: today ? Math.max(f.now.temp, today.tMax) : f.now.temp,
    apparent: f.now.apparent,
    code: today && today.precipProbMax >= 60 ? today.code : f.now.code,
    windKmh: Math.max(f.now.windKmh, today?.windMaxKmh ?? 0),
    precipProb: today?.precipProbMax ?? f.now.precipProb,
    uv: today?.uvMax,
  })[0];
  if (activity !== 'strength') {
    const best = bestHour(f.hours);
    if (best) parts.push(`Mejor hora para salir: ${Number(best.time.slice(11, 13))} h.`);
  }
  if (tip && tip.level !== 'ok') parts.push(tip.text);
  return parts.join(' ');
}

/**
 * Aviso de la mañana (lo que toca hoy + clima) o de la noche (si la sesión sigue pendiente).
 * null = no hay nada que avisar (p. ej. descanso a la noche o sesión ya hecha).
 */
export function composeReminder(kind: ReminderKind, day: DayInfo | null, forecast: Forecast | null, includeWeather: boolean): Message | null {
  const wx = includeWeather && forecast;

  if (kind === 'evening') {
    if (!day || day.session_type === 'rest' || day.status === 'completed' || day.status === 'skipped') return null;
    return {
      title: 'Te queda la sesión de hoy',
      body: `${day.title} · ~${day.estimated_minutes} min. Si hoy no da, movela a otro día desde el plan.`,
      url: `/entrenar/dia/${day.id}`,
      tag: 'fit20-evening',
    };
  }

  if (!day) {
    if (!wx) return null;
    return { title: 'Clima de hoy', body: weatherLine(forecast!, 'walk'), url: '/', tag: 'fit20-morning' };
  }
  if (day.status === 'completed') return null;

  if (day.session_type === 'rest') {
    return {
      title: 'Hoy es día de descanso',
      body: wx ? `Recuperá bien. ${weatherLine(forecast!, 'walk')}` : 'Recuperá bien: dormí, hidratate y comé proteína.',
      url: '/',
      tag: 'fit20-morning',
    };
  }

  const act = activityFor(day);
  let extra = '';
  if (day.session_type === 'strength_run' && day.run_activity && !day.title.includes('+')) extra = ` + ${ACT[day.run_activity]}`;
  if (day.session_type === 'run' && day.run_distance_km) extra = ` · ${day.run_distance_km.toLocaleString('es-AR')} km`;
  const head = `${day.title}${extra} · ~${day.estimated_minutes} min.`;
  return {
    title: 'Hoy toca entrenar',
    body: wx ? `${head} ${weatherLine(forecast!, act)}` : head,
    url: `/entrenar/dia/${day.id}`,
    tag: 'fit20-morning',
  };
}
