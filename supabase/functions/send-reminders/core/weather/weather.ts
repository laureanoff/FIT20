/**
 * Clima para entrenar: lectura de Open-Meteo (gratis, sin clave) y consejos según la actividad.
 * Puro y sin dependencias: lo usan la app y la función que manda las notificaciones.
 */

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';
export type AdviceActivity = 'run' | 'walk' | 'bike' | 'strength';

export interface WeatherNow {
  time: string; // hora local del lugar, "YYYY-MM-DDTHH:mm"
  temp: number;
  apparent: number;
  code: number;
  windKmh: number;
  precipProb: number;
  isDay: boolean;
}

export interface WeatherHour {
  time: string;
  temp: number;
  code: number;
  precipProb: number;
  windKmh: number;
}

export interface WeatherDay {
  date: string;
  code: number;
  tMax: number;
  tMin: number;
  precipProbMax: number;
  windMaxKmh: number;
  uvMax: number;
}

export interface Forecast {
  fetchedAt: string; // ISO UTC
  lat: number;
  lon: number;
  timezone: string;
  now: WeatherNow;
  hours: WeatherHour[]; // desde la hora actual en adelante
  days: WeatherDay[];
}

export interface Advice {
  level: 'ok' | 'info' | 'warn';
  text: string;
}

/** ~1 km de precisión: alcanza para el pronóstico y no guarda la ubicación exacta. */
export const roundCoord = (n: number): number => Math.round(n * 100) / 100;

export function openMeteoUrl(lat: number, lon: number, days = 7): string {
  const q: [string, string][] = [
    ['latitude', String(roundCoord(lat))],
    ['longitude', String(roundCoord(lon))],
    ['current', 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day'],
    ['hourly', 'temperature_2m,weather_code,precipitation_probability,wind_speed_10m'],
    ['daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max'],
    ['timezone', 'auto'],
    ['wind_speed_unit', 'kmh'],
    ['forecast_days', String(days)],
  ];
  return `https://api.open-meteo.com/v1/forecast?${q.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

const KINDS: [number, WeatherKind, string][] = [
  [0, 'clear', 'Despejado'],
  [1, 'clear', 'Mayormente despejado'],
  [2, 'partly', 'Parcialmente nublado'],
  [3, 'cloudy', 'Nublado'],
  [45, 'fog', 'Niebla'],
  [48, 'fog', 'Niebla con escarcha'],
  [51, 'drizzle', 'Llovizna leve'],
  [53, 'drizzle', 'Llovizna'],
  [55, 'drizzle', 'Llovizna intensa'],
  [56, 'drizzle', 'Llovizna helada'],
  [57, 'drizzle', 'Llovizna helada'],
  [61, 'rain', 'Lluvia leve'],
  [63, 'rain', 'Lluvia'],
  [65, 'rain', 'Lluvia fuerte'],
  [66, 'rain', 'Lluvia helada'],
  [67, 'rain', 'Lluvia helada'],
  [71, 'snow', 'Nevada leve'],
  [73, 'snow', 'Nevada'],
  [75, 'snow', 'Nevada fuerte'],
  [77, 'snow', 'Granizo fino'],
  [80, 'rain', 'Chaparrones'],
  [81, 'rain', 'Chaparrones'],
  [82, 'rain', 'Chaparrones fuertes'],
  [85, 'snow', 'Chaparrones de nieve'],
  [86, 'snow', 'Chaparrones de nieve'],
  [95, 'storm', 'Tormenta'],
  [96, 'storm', 'Tormenta con granizo'],
  [99, 'storm', 'Tormenta con granizo'],
];

export function describeCode(code: number): { kind: WeatherKind; label: string } {
  const hit = KINDS.find(([c]) => c === code);
  if (hit) return { kind: hit[1], label: hit[2] };
  if (code >= 95) return { kind: 'storm', label: 'Tormenta' };
  if (code >= 70) return { kind: 'snow', label: 'Nieve' };
  if (code >= 60) return { kind: 'rain', label: 'Lluvia' };
  if (code >= 50) return { kind: 'drizzle', label: 'Llovizna' };
  return { kind: 'cloudy', label: 'Nublado' };
}

const wet = (code: number) => ['drizzle', 'rain', 'snow', 'storm'].includes(describeCode(code).kind);

type Num = number | null | undefined;
const n = (v: Num, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Convierte la respuesta de Open-Meteo. Lanza un error si falta lo esencial. */
export function parseOpenMeteo(json: unknown, fetchedAt: string = new Date().toISOString()): Forecast {
  const j = json as {
    latitude?: number;
    longitude?: number;
    timezone?: string;
    current?: { time?: string; temperature_2m?: number; apparent_temperature?: number; weather_code?: number; wind_speed_10m?: number; is_day?: number };
    hourly?: { time?: string[]; temperature_2m?: Num[]; weather_code?: Num[]; precipitation_probability?: Num[]; wind_speed_10m?: Num[] };
    daily?: { time?: string[]; weather_code?: Num[]; temperature_2m_max?: Num[]; temperature_2m_min?: Num[]; precipitation_probability_max?: Num[]; wind_speed_10m_max?: Num[]; uv_index_max?: Num[] };
  };
  if (!j?.current || typeof j.current.temperature_2m !== 'number' || !j.current.time) throw new Error('Respuesta de clima incompleta');

  const h = j.hourly ?? {};
  const allHours: WeatherHour[] = (h.time ?? []).map((time, i) => ({
    time,
    temp: n(h.temperature_2m?.[i]),
    code: n(h.weather_code?.[i]),
    precipProb: n(h.precipitation_probability?.[i]),
    windKmh: n(h.wind_speed_10m?.[i]),
  }));
  const hourKey = j.current.time.slice(0, 13); // "YYYY-MM-DDTHH"
  const startIdx = Math.max(0, allHours.findIndex((x) => x.time.slice(0, 13) === hourKey));
  const hours = allHours.slice(startIdx);

  const d = j.daily ?? {};
  const days: WeatherDay[] = (d.time ?? []).map((date, i) => ({
    date,
    code: n(d.weather_code?.[i]),
    tMax: n(d.temperature_2m_max?.[i]),
    tMin: n(d.temperature_2m_min?.[i]),
    precipProbMax: n(d.precipitation_probability_max?.[i]),
    windMaxKmh: n(d.wind_speed_10m_max?.[i]),
    uvMax: n(d.uv_index_max?.[i]),
  }));

  const c = j.current;
  return {
    fetchedAt,
    lat: n(j.latitude),
    lon: n(j.longitude),
    timezone: j.timezone ?? 'UTC',
    now: {
      time: c.time!,
      temp: n(c.temperature_2m),
      apparent: n(c.apparent_temperature, n(c.temperature_2m)),
      code: n(c.weather_code),
      windKmh: n(c.wind_speed_10m),
      precipProb: hours[0]?.precipProb ?? 0,
      isDay: c.is_day !== 0,
    },
    hours,
    days,
  };
}

export interface Conditions {
  temp: number;
  apparent?: number;
  code: number;
  windKmh: number;
  precipProb: number;
  uv?: number;
  isDay?: boolean;
}

/**
 * Consejos concretos para la actividad, de mayor a menor importancia (máx. 3).
 * Fuerza: solo importa si hace mucho calor (la sesión es bajo techo o en casa).
 */
export function adviceFor(activity: AdviceActivity, w: Conditions): Advice[] {
  const out: Advice[] = [];
  const kind = describeCode(w.code).kind;
  const feels = w.apparent ?? w.temp;
  const outdoor = activity !== 'strength';

  if (outdoor) {
    if (kind === 'storm') out.push({ level: 'warn', text: 'Tormenta: hacé el cardio bajo techo (cinta, bici fija) o movelo a otro horario.' });
    else if (wet(w.code) || w.precipProb >= 60) {
      out.push({
        level: 'warn',
        text:
          activity === 'bike'
            ? 'Lluvia probable: con piso mojado frená antes y evitá las líneas pintadas, o pasá a bici fija.'
            : 'Lluvia probable: llevá rompeviento o pasá a la cinta.',
      });
    } else if (w.precipProb >= 35) out.push({ level: 'info', text: `${w.precipProb}% de chance de lluvia: mirá el cielo antes de salir.` });
  }

  if (feels >= 32) out.push({ level: 'warn', text: 'Calor fuerte: entrená temprano o de noche, bajá la intensidad y tomá agua cada 15–20 min.' });
  else if (feels >= 27) out.push({ level: 'info', text: 'Hace calor: tomá agua antes y después, y bajá un poco el ritmo.' });
  else if (outdoor && feels <= 0) out.push({ level: 'warn', text: 'Helada: cuidado con el piso resbaloso; abrigate en capas y cubrí manos y orejas.' });
  else if (outdoor && feels <= 6) out.push({ level: 'info', text: 'Frío: abrigate en capas y hacé la entrada en calor adentro.' });

  if (outdoor && activity === 'bike' && w.windKmh >= 30) out.push({ level: 'warn', text: `Viento de ${Math.round(w.windKmh)} km/h: arrancá contra el viento para volver con él a favor.` });
  else if (outdoor && w.windKmh >= 40) out.push({ level: 'info', text: `Viento fuerte (${Math.round(w.windKmh)} km/h): elegí un recorrido reparado.` });

  if (outdoor && kind === 'fog') out.push({ level: 'info', text: 'Niebla: usá ropa clara o reflectiva y luces.' });
  if (outdoor && (w.uv ?? 0) >= 8 && w.isDay !== false) out.push({ level: 'info', text: 'Índice UV muy alto: protector solar y gorra.' });

  if (!out.length) out.push({ level: 'ok', text: outdoor ? 'Buen clima para salir.' : 'Nada que te frene hoy.' });
  return out.slice(0, 3);
}

/**
 * Mejor hora para salir en las próximas horas (entre 6 y 22 h): poca lluvia y temperatura cómoda.
 * null si ninguna hora es razonable.
 */
export function bestHour(hours: WeatherHour[], within = 14): WeatherHour | null {
  let best: WeatherHour | null = null;
  let bestScore = Infinity;
  for (const x of hours.slice(0, within)) {
    const hour = Number(x.time.slice(11, 13));
    if (hour < 6 || hour > 21) continue;
    const kind = describeCode(x.code).kind;
    if (kind === 'storm') continue;
    const comfort = Math.abs(x.temp - 15); // 10–20 °C ideal para cardio
    const score = x.precipProb * 1.5 + comfort * 2 + (wet(x.code) ? 60 : 0) + Math.max(0, x.windKmh - 25);
    if (score < bestScore) {
      bestScore = score;
      best = x;
    }
  }
  return best && bestScore < 120 ? best : null;
}

/**
 * Pronóstico guardado, "movido" a otra hora (p. ej. el que bajó el teléfono anoche, usado a la mañana).
 * localHour: "YYYY-MM-DDTHH" en la zona del pronóstico. null si esa hora no está cubierta.
 */
export function forecastAt(f: Forecast, localHour: string): Forecast | null {
  const i = f.hours.findIndex((h) => h.time.slice(0, 13) === localHour.slice(0, 13));
  if (i < 0) return null;
  const h = f.hours[i]!;
  const hour = Number(localHour.slice(11, 13));
  return {
    ...f,
    now: { time: h.time, temp: h.temp, apparent: h.temp, code: h.code, windKmh: h.windKmh, precipProb: h.precipProb, isDay: hour >= 7 && hour < 20 },
    hours: f.hours.slice(i),
    days: f.days.filter((d) => d.date >= localHour.slice(0, 10)),
  };
}

/** Versión liviana para guardar en el servidor: próximas 48 h y 3 días. */
export function trimForecast(f: Forecast): Forecast {
  return { ...f, hours: f.hours.slice(0, 48), days: f.days.slice(0, 3) };
}

export const fmtTemp =(t: number): string => `${Math.round(t)}°`;

/** Resumen corto, p. ej. "Despejado · 15° (máx 19°)". */
export function shortSummary(f: Forecast): string {
  const today = f.days[0];
  const { label } = describeCode(f.now.code);
  return `${label} · ${fmtTemp(f.now.temp)}${today ? ` (máx ${fmtTemp(today.tMax)})` : ''}`;
}

/** Pronóstico de un día como condiciones para los consejos. */
export function dayConditions(d: WeatherDay): Conditions {
  return { temp: d.tMax, code: d.code, windKmh: d.windMaxKmh, precipProb: d.precipProbMax, uv: d.uvMax };
}
