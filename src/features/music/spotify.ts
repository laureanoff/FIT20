/**
 * Spotify dentro de FIT 20 (Web API + inicio de sesión PKCE, sin servidor ni secretos).
 *
 * La música suena en la app de Spotify del teléfono (sigue con el celu bloqueado y en segundo plano);
 * desde FIT 20 se ve qué suena, se pausa, se pasa de tema y se elige una playlist.
 * Controlar la reproducción requiere Spotify Premium (regla de Spotify); sin Premium se ve qué suena.
 */

const ENV_CLIENT_ID = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim() || '';
const CLIENT_KEY = 'fit20:spotify-client-id';

/** Client ID de la app de Spotify: el de la instalación (Vercel) o el que pegaste en Perfil → Música. Es público. */
export function clientId(): string {
  if (ENV_CLIENT_ID) return ENV_CLIENT_ID;
  try {
    return localStorage.getItem(CLIENT_KEY) ?? '';
  } catch {
    return '';
  }
}
export const clientIdFromEnv = (): boolean => !!ENV_CLIENT_ID;
export const validClientId = (v: string): boolean => /^[0-9a-f]{32}$/i.test(v.trim());
export function setClientId(v: string): void {
  try {
    localStorage.setItem(CLIENT_KEY, v.trim());
  } catch {
    /* nada */
  }
  listeners.forEach((l) => l());
}
const SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private', 'playlist-read-collaborative'];
const TOKEN_KEY = 'fit20:spotify';
const VERIFIER_KEY = 'fit20:spotify-verifier';
const RETURN_KEY = 'fit20:spotify-return';
const API = 'https://api.spotify.com/v1';

export const spotifyConfigured = (): boolean => validClientId(clientId());
export const redirectUri = (): string => `${window.location.origin}/spotify/callback`;

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms
}

export interface Track {
  name: string;
  artists: string;
  image: string | null;
  durationMs: number;
  uri: string;
}

export interface Playback {
  isPlaying: boolean;
  track: Track | null;
  progressMs: number;
  device: string | null;
  fetchedAt: number;
}

export interface Playlist {
  id: string;
  uri: string;
  name: string;
  image: string | null;
  tracks: number;
}

export class SpotifyError extends Error {
  constructor(
    public code: 'not_connected' | 'premium' | 'no_device' | 'expired' | 'network' | 'rate' | 'other',
    message: string,
  ) {
    super(message);
  }
}

// ───────── Sesión ─────────

function readTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}
function writeTokens(t: Tokens | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sin almacenamiento */
  }
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();
export function onSpotifyChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const spotifyConnected = (): boolean => !!readTokens();

export function disconnectSpotify(): void {
  writeTokens(null);
}

// ───────── PKCE ─────────

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomVerifier(len = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const rnd = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(rnd, (b) => chars[b % chars.length]).join('');
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

/** Lleva a Spotify para autorizar; vuelve a /spotify/callback y después a `returnTo`. */
export async function connectSpotify(returnTo: string = window.location.pathname + window.location.search): Promise<void> {
  if (!spotifyConfigured()) throw new SpotifyError('other', 'Spotify todavía no está configurado en FIT 20.');
  if (!navigator.onLine) throw new SpotifyError('network', 'Necesitás internet para conectar Spotify.');
  const verifier = randomVerifier();
  const state = randomVerifier(16);
  sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, state }));
  sessionStorage.setItem(RETURN_KEY, returnTo);
  const q = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    scope: SCOPES.join(' '),
    state,
  });
  window.location.assign(`https://accounts.spotify.com/authorize?${q.toString()}`);
}

/** Completa el inicio de sesión al volver de Spotify. Devuelve a dónde ir después. */
export async function finishSpotifyLogin(search: string): Promise<string> {
  const p = new URLSearchParams(search);
  const back = sessionStorage.getItem(RETURN_KEY) || '/perfil/musica';
  const saved = JSON.parse(sessionStorage.getItem(VERIFIER_KEY) || 'null') as { verifier: string; state: string } | null;
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  if (p.get('error')) throw new SpotifyError('other', p.get('error') === 'access_denied' ? 'Cancelaste la conexión con Spotify.' : 'Spotify no autorizó la conexión.');
  const code = p.get('code');
  if (!code || !saved || p.get('state') !== saved.state) throw new SpotifyError('other', 'La conexión con Spotify venció. Probá de nuevo.');
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: saved.verifier });
  writeTokens(t);
  return back;
}

async function tokenRequest(body: Record<string, string>, previousRefresh?: string): Promise<Tokens> {
  let res: Response;
  try {
    res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), ...body }).toString(),
    });
  } catch {
    throw new SpotifyError('network', 'Sin conexión con Spotify.');
  }
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new SpotifyError('expired', 'La conexión con Spotify venció: conectala de nuevo.');
    throw new SpotifyError('other', 'Spotify no respondió. Probá en un rato.');
  }
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return { access_token: j.access_token, refresh_token: j.refresh_token ?? previousRefresh ?? '', expires_at: Date.now() + (j.expires_in - 60) * 1000 };
}

let refreshing: Promise<Tokens> | null = null;
async function accessToken(): Promise<string> {
  const t = readTokens();
  if (!t) throw new SpotifyError('not_connected', 'Conectá Spotify para controlar la música.');
  if (Date.now() < t.expires_at) return t.access_token;
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token }, t.refresh_token)
    .then((n) => {
      writeTokens(n);
      return n;
    })
    .catch((e: SpotifyError) => {
      if (e.code === 'expired') writeTokens(null);
      throw e;
    })
    .finally(() => {
      refreshing = null;
    });
  return (await refreshing).access_token;
}

// ───────── API ─────────

async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T | null> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  } catch {
    throw new SpotifyError('network', 'Sin conexión con Spotify.');
  }
  if (res.status === 401 && !retried) {
    const t = readTokens();
    if (t) writeTokens({ ...t, expires_at: 0 }); // forzar renovación
    return api<T>(path, init, true);
  }
  if (res.status === 204 || res.status === 202) return null;
  if (res.ok) {
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }
  const err = (await res.json().catch(() => ({}))) as { error?: { reason?: string; message?: string } };
  const reason = err.error?.reason ?? '';
  if (res.status === 403 && (reason === 'PREMIUM_REQUIRED' || /premium/i.test(err.error?.message ?? ''))) throw new SpotifyError('premium', 'Controlar la música desde otra app requiere Spotify Premium.');
  if (res.status === 404 && (reason === 'NO_ACTIVE_DEVICE' || /device/i.test(err.error?.message ?? ''))) throw new SpotifyError('no_device', 'Abrí Spotify en el teléfono y poné play una vez; después la controlás desde acá.');
  if (res.status === 429) throw new SpotifyError('rate', 'Spotify pidió esperar un momento.');
  throw new SpotifyError('other', 'Spotify no respondió como esperaba.');
}

interface RawTrack {
  name: string;
  uri: string;
  duration_ms: number;
  artists?: { name: string }[];
  album?: { images?: { url: string; width?: number }[] };
  show?: { name: string; images?: { url: string }[] };
}

const smallestImage = (imgs?: { url: string; width?: number }[]) => (imgs?.length ? [...imgs].sort((a, b) => (a.width ?? 999) - (b.width ?? 999)).find((i) => (i.width ?? 300) >= 64)?.url ?? imgs[0]!.url : null);

export function toTrack(t: RawTrack | null | undefined): Track | null {
  if (!t) return null;
  return {
    name: t.name,
    artists: t.artists?.map((a) => a.name).join(', ') || t.show?.name || '',
    image: smallestImage(t.album?.images ?? t.show?.images),
    durationMs: t.duration_ms,
    uri: t.uri,
  };
}

export async function getPlayback(): Promise<Playback | null> {
  const j = await api<{ is_playing: boolean; progress_ms: number | null; item: RawTrack | null; device?: { name: string } }>('/me/player?additional_types=episode');
  if (!j) return null;
  return { isPlaying: j.is_playing, track: toTrack(j.item), progressMs: j.progress_ms ?? 0, device: j.device?.name ?? null, fetchedAt: Date.now() };
}

async function deviceId(): Promise<string | undefined> {
  const j = await api<{ devices: { id: string; is_active: boolean; type: string }[] }>('/me/player/devices');
  const devs = j?.devices ?? [];
  return (devs.find((d) => d.is_active) ?? devs.find((d) => d.type === 'Smartphone') ?? devs[0])?.id;
}

/** Ejecuta un comando; si no hay dispositivo activo, intenta con el teléfono (si Spotify estuvo abierto hace poco). */
async function command(path: string, method: 'PUT' | 'POST', body?: unknown): Promise<void> {
  try {
    await api(path, { method, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (!(e instanceof SpotifyError) || e.code !== 'no_device') throw e;
    const id = await deviceId();
    if (!id) throw e;
    const sep = path.includes('?') ? '&' : '?';
    await api(`${path}${sep}device_id=${encodeURIComponent(id)}`, { method, body: body ? JSON.stringify(body) : undefined });
  }
}

export const play = () => command('/me/player/play', 'PUT');
export const pause = () => command('/me/player/pause', 'PUT');
export const next = () => command('/me/player/next', 'POST');
export const previous = () => command('/me/player/previous', 'POST');
export const playPlaylist = (uri: string) => command('/me/player/play', 'PUT', { context_uri: uri });

export async function myPlaylists(): Promise<Playlist[]> {
  const j = await api<{ items: ({ id: string; uri: string; name: string; images?: { url: string; width?: number }[] | null; tracks?: { total: number }; items?: { total: number } } | null)[] }>('/me/playlists?limit=50');
  return (j?.items ?? [])
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, uri: p.uri, name: p.name, image: smallestImage(p.images ?? undefined), tracks: p.tracks?.total ?? p.items?.total ?? 0 }));
}

/** Abre la app de Spotify (para "despertarla" cuando no hay dispositivo activo). */
export const SPOTIFY_APP_URL = 'spotify:';
