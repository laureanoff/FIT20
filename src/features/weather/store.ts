import { useSyncExternalStore } from 'react';
import { openMeteoUrl, parseOpenMeteo, roundCoord, type Forecast } from '@/core/weather/weather';

/**
 * Clima compartido por toda la app. La ubicación se guarda redondeada (~1 km) y solo en este
 * dispositivo; el último pronóstico queda guardado para verlo sin internet.
 */

export interface Coords {
  lat: number;
  lon: number;
}

export type WeatherStatus = 'off' | 'locating' | 'loading' | 'ready' | 'denied' | 'error';

export interface WeatherState {
  status: WeatherStatus;
  forecast: Forecast | null;
  coords: Coords | null;
  /** true si el pronóstico mostrado tiene más de 3 h (p. ej. sin internet). */
  stale: boolean;
  error: string | null;
}

const LOC_KEY = 'fit20:wx-loc';
const FC_KEY = 'fit20:wx-forecast';
const FRESH_MS = 30 * 60 * 1000;
const STALE_MS = 3 * 60 * 60 * 1000;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento lleno o bloqueado: el clima es opcional */
  }
}

const age = (f: Forecast | null) => (f ? Date.now() - new Date(f.fetchedAt).getTime() : Infinity);

let state: WeatherState = (() => {
  const coords = read<Coords>(LOC_KEY);
  const forecast = read<Forecast>(FC_KEY);
  return { status: coords ? (forecast ? 'ready' : 'loading') : 'off', coords, forecast: coords ? forecast : null, stale: age(forecast) > STALE_MS, error: null };
})();

const listeners = new Set<() => void>();
function set(patch: Partial<WeatherState>): void {
  state = { ...state, ...patch };
  state.stale = age(state.forecast) > STALE_MS;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let inflight: Promise<void> | null = null;

/** Descarga el pronóstico si el guardado tiene más de 30 min (o si se fuerza). */
export function refreshWeather(force = false): Promise<void> {
  const coords = state.coords;
  if (!coords) return Promise.resolve();
  if (!force && age(state.forecast) < FRESH_MS) return Promise.resolve();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (state.status === 'loading') set({ status: state.forecast ? 'ready' : 'error', error: state.forecast ? null : 'Sin conexión' });
    return Promise.resolve();
  }
  if (inflight) return inflight;
  if (!state.forecast) set({ status: 'loading' });
  inflight = (async () => {
    try {
      const res = await fetch(openMeteoUrl(coords.lat, coords.lon));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const forecast = parseOpenMeteo(await res.json());
      write(FC_KEY, forecast);
      set({ forecast, status: 'ready', error: null });
    } catch {
      set({ status: state.forecast ? 'ready' : 'error', error: 'No se pudo cargar el clima' });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Guarda una ubicación (p. ej. el primer punto de una salida con GPS) sin pedir permiso de nuevo. */
export function rememberLocation(lat: number, lon: number): void {
  const coords = { lat: roundCoord(lat), lon: roundCoord(lon) };
  const prev = state.coords;
  if (prev && Math.abs(prev.lat - coords.lat) < 0.05 && Math.abs(prev.lon - coords.lon) < 0.05) return; // mismo barrio
  write(LOC_KEY, coords);
  set({ coords, status: state.forecast ? state.status : 'loading' });
  void refreshWeather(true);
}

/** Pide la ubicación (una vez, con precisión baja) y carga el clima. */
export function enableWeather(): Promise<void> {
  if (!('geolocation' in navigator)) {
    set({ status: 'error', error: 'Este dispositivo no comparte ubicación' });
    return Promise.resolve();
  }
  set({ status: 'locating', error: null });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const coords = { lat: roundCoord(p.coords.latitude), lon: roundCoord(p.coords.longitude) };
        write(LOC_KEY, coords);
        set({ coords });
        void refreshWeather(true).then(resolve);
      },
      (err) => {
        set({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'error', error: err.code === err.PERMISSION_DENIED ? null : 'No se pudo obtener tu ubicación' });
        resolve();
      },
      { enableHighAccuracy: false, maximumAge: 60 * 60 * 1000, timeout: 15000 },
    );
  });
}

/** Olvida la ubicación y el pronóstico guardados. */
export function disableWeather(): void {
  write(LOC_KEY, null);
  write(FC_KEY, null);
  set({ coords: null, forecast: null, status: 'off', error: null });
}

export { subscribe as subscribeWeather };

export function getWeatherState(): WeatherState {
  return state;
}

/** Estado del clima; al montarse refresca si el pronóstico guardado está viejo. */
export function useWeather(): WeatherState {
  const s = useSyncExternalStore(subscribe, getWeatherState, getWeatherState);
  return s;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void refreshWeather());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshWeather();
  });
  if (state.coords) queueMicrotask(() => void refreshWeather());
}

/** Solo para tests. */
export function __resetWeather(): void {
  state = { status: 'off', coords: null, forecast: null, stale: false, error: null };
  listeners.forEach((l) => l());
}
