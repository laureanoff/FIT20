/**
 * Cálculos de running: distancia GPS con filtrado de ruido, parciales por km, ritmo y marcas.
 * Todo puro para poder testearlo sin GPS real.
 */

export interface GpsPoint {
  lat: number;
  lng: number;
  /** Precisión horizontal reportada por el dispositivo, en metros. */
  accuracy: number;
  /** Tiempo ACTIVO de la carrera (cronómetro, sin pausas) al registrar el punto. */
  elapsed_ms: number;
  /** Segmento: cambia al reanudar tras una pausa, para no unir puntos a través de la pausa. */
  segment: number;
}

export const GPS_MAX_ACCURACY_M = 30;
export const GPS_MIN_STEP_M = 3;
export const GPS_MAX_SPEED_MPS = 8; // ~2:05 min/km: por encima es un salto de GPS, no una carrera

export type Activity = 'run' | 'walk' | 'bike';

/**
 * Límites por actividad: velocidad máxima creíble (para descartar saltos de GPS) y rango de
 * ritmo aceptado en el registro manual (seg/km).
 */
export const ACTIVITY_LIMITS: Record<Activity, { maxSpeedMps: number; minPace: number; maxPace: number }> = {
  run: { maxSpeedMps: GPS_MAX_SPEED_MPS, minPace: 150, maxPace: 30 * 60 },
  walk: { maxSpeedMps: 4, minPace: 5 * 60, maxPace: 30 * 60 },
  bike: { maxSpeedMps: 22, minPace: 50, maxPace: 15 * 60 }, // ~80 km/h en bajada … 4 km/h
};

const R = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface TrackResult {
  distance_m: number;
  accepted: GpsPoint[];
  /** Distancia acumulada en cada punto aceptado (misma longitud que accepted). */
  cumulative_m: number[];
}

/** Acumula distancia descartando puntos imprecisos, micro-movimientos (deriva) y saltos imposibles. */
export function accumulateTrack(points: readonly GpsPoint[], maxSpeedMps = GPS_MAX_SPEED_MPS): TrackResult {
  const accepted: GpsPoint[] = [];
  const cumulative: number[] = [];
  let total = 0;
  for (const p of points) {
    if (!(p.accuracy <= GPS_MAX_ACCURACY_M)) continue;
    const last = accepted[accepted.length - 1];
    if (!last || last.segment !== p.segment) {
      accepted.push(p);
      cumulative.push(total);
      continue;
    }
    const d = haversineM(last, p);
    const dt = (p.elapsed_ms - last.elapsed_ms) / 1000;
    if (d < Math.max(GPS_MIN_STEP_M, p.accuracy / 4)) continue; // deriva estando quieto
    if (dt <= 0 || d / dt > maxSpeedMps) continue; // salto de GPS
    total += d;
    accepted.push(p);
    cumulative.push(total);
  }
  return { distance_m: total, accepted, cumulative_m: cumulative };
}

export interface Split {
  km: number;
  duration_s: number;
}

/** Parciales por kilómetro interpolando el momento exacto en que se cruza cada km. */
export function computeSplits(track: TrackResult): Split[] {
  const splits: Split[] = [];
  let nextKm = 1000;
  let lastCrossMs = track.accepted[0]?.elapsed_ms ?? 0;
  for (let i = 1; i < track.accepted.length; i++) {
    const d0 = track.cumulative_m[i - 1]!;
    const d1 = track.cumulative_m[i]!;
    const t0 = track.accepted[i - 1]!.elapsed_ms;
    const t1 = track.accepted[i]!.elapsed_ms;
    while (d1 >= nextKm && d1 > d0) {
      const crossMs = t0 + ((nextKm - d0) / (d1 - d0)) * (t1 - t0);
      splits.push({ km: nextKm / 1000, duration_s: Math.round((crossMs - lastCrossMs) / 1000) });
      lastCrossMs = crossMs;
      nextKm += 1000;
    }
  }
  return splits;
}

/** Ritmo en segundos por km (null si no hay distancia). */
export function paceSecPerKm(distanceKm: number, durationS: number): number | null {
  if (!(distanceKm > 0) || !(durationS > 0)) return null;
  return durationS / distanceKm;
}

export function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm)) return '—';
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function speedKmh(distanceKm: number, durationS: number): number {
  return durationS > 0 ? Math.round((distanceKm / (durationS / 3600)) * 10) / 10 : 0;
}

// ───────── Registro manual ─────────

export interface ManualRunInput {
  distance_km: number;
  duration: string; // "mm:ss" o "h:mm:ss"
}

export function parseDuration(s: string): number | null {
  const parts = s.trim().split(':').map((x) => x.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, sec] = nums.length === 3 ? nums : [0, nums[0]!, nums[1]!];
  if (m! >= 60 && nums.length === 3) return null;
  if (sec! >= 60) return null;
  return h! * 3600 + m! * 60 + sec!;
}

export function validateManualRun(input: ManualRunInput, activity: Activity = 'run'): { ok: true; duration_s: number; pace: number } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!(input.distance_km > 0) || input.distance_km > 300) errors.push('La distancia debe estar entre 0 y 300 km.');
  const d = parseDuration(input.duration);
  if (d === null || d <= 0) errors.push('El tiempo debe tener formato mm:ss o h:mm:ss.');
  if (errors.length) return { ok: false, errors };
  const pace = paceSecPerKm(input.distance_km, d!)!;
  const lim = ACTIVITY_LIMITS[activity];
  if (pace < lim.minPace) {
    const msg = activity === 'run' ? 'Ese ritmo es más rápido que el récord mundial: revisá distancia y tiempo.'
      : activity === 'walk' ? 'Ese ritmo es demasiado rápido para una caminata (más de 12 km/h): ¿fue una carrera?'
        : 'Esa velocidad supera los 70 km/h: revisá distancia y tiempo.';
    return { ok: false, errors: [msg] };
  }
  if (pace > lim.maxPace) return { ok: false, errors: [`El ritmo resultante supera ${Math.round(lim.maxPace / 60)} min/km: revisá los datos.`] };
  return { ok: true, duration_s: d!, pace };
}

// ───────── Estadísticas ─────────

export interface RunSummary {
  session_date: string; // YYYY-MM-DD
  distance_km: number;
  duration_seconds: number;
  splits?: Split[];
}

export interface PersonalBests {
  longest_km: number | null;
  fastest_pace_3k_plus: number | null;
  best_1k_s: number | null;
  best_5k_s: number | null;
  total_km: number;
  total_seconds: number;
}

export function personalBests(runs: readonly RunSummary[]): PersonalBests {
  let longest: number | null = null;
  let fastest: number | null = null;
  let best1k: number | null = null;
  let best5k: number | null = null;
  let totalKm = 0;
  let totalS = 0;
  for (const r of runs) {
    totalKm += r.distance_km;
    totalS += r.duration_seconds;
    longest = Math.max(longest ?? 0, r.distance_km);
    const p = paceSecPerKm(r.distance_km, r.duration_seconds);
    if (p && r.distance_km >= 3) fastest = fastest === null ? p : Math.min(fastest, p);
    for (const s of r.splits ?? []) best1k = best1k === null ? s.duration_s : Math.min(best1k, s.duration_s);
    // 5 km: mejor ventana de 5 parciales consecutivos.
    const sp = r.splits ?? [];
    for (let i = 0; i + 5 <= sp.length; i++) {
      const t = sp.slice(i, i + 5).reduce((a, x) => a + x.duration_s, 0);
      best5k = best5k === null ? t : Math.min(best5k, t);
    }
  }
  return { longest_km: longest, fastest_pace_3k_plus: fastest, best_1k_s: best1k, best_5k_s: best5k, total_km: Math.round(totalKm * 100) / 100, total_seconds: totalS };
}
