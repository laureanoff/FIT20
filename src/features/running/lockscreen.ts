/**
 * Actividad en la pantalla de bloqueo.
 *
 * Una web no puede crear "actividades en vivo" como una app nativa, pero sí usar el panel de
 * "reproduciendo ahora" (Media Session): muestra distancia, tiempo y ritmo, con pausa/reanudar
 * sin desbloquear, en Android (pantalla de bloqueo y notificaciones) y en iPhone.
 * Para que el sistema lo muestre, la app reproduce un tono inaudible (30 Hz, -64 dB) en bucle;
 * eso además evita que el navegador congele la app con la pantalla apagada.
 */

export interface LockScreenState {
  activityLabel: string; // "Running", "Caminata", "Bici"
  distanceKm: number;
  elapsedMs: number;
  /** "5:24/km" o "28,1 km/h"; null si todavía no hay dato. */
  rate: string | null;
  running: boolean;
  targetKm?: number | null;
  targetSeconds?: number | null;
}

export interface LockScreenHandlers {
  onPause: () => void;
  onResume: () => void;
}

const PREF_KEY = 'fit20:lockscreen';

export function lockScreenEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setLockScreenEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* opcional */
  }
}

export function lockScreenSupported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof Audio !== 'undefined';
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/** Textos del panel: título grande con km y tiempo; debajo ritmo, actividad y objetivo. */
export function lockScreenText(s: LockScreenState): { title: string; artist: string; album: string } {
  const km = s.distanceKm.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const title = `${km} km · ${clock(s.elapsedMs)}`;
  const parts = [s.running ? s.activityLabel : `${s.activityLabel} en pausa`];
  if (s.rate) parts.push(s.rate);
  if (s.targetKm) parts.push(`objetivo ${s.targetKm.toLocaleString('es-AR')} km`);
  return { title, artist: parts.join(' · '), album: 'FIT 20' };
}

/** WAV de 2 s: tono de 30 Hz muy bajo. Inaudible en el parlante del teléfono, pero el sistema lo cuenta como audio. */
function keepAliveWav(): string {
  const rate = 8000;
  const seconds = 2;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(20 * Math.sin((2 * Math.PI * 30 * i) / rate)), true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let lastText = '';
let lastPositionAt = 0;

/** Debe llamarse dentro de un toque del usuario (Empezar/Reanudar): los navegadores exigen eso para reproducir audio. */
export async function startLockScreen(handlers: LockScreenHandlers): Promise<boolean> {
  if (!lockScreenSupported() || !lockScreenEnabled()) return false;
  try {
    if (!audio) {
      audioUrl = keepAliveWav();
      audio = new Audio(audioUrl);
      audio.loop = true;
      audio.setAttribute('playsinline', '');
      audio.preload = 'auto';
    }
    await audio.play();
  } catch {
    return false; // sin permiso de audio: la app sigue funcionando igual, sin el panel
  }
  const ms = navigator.mediaSession;
  const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(a, h);
    } catch {
      /* acción no soportada en este navegador */
    }
  };
  set('play', () => handlers.onResume());
  set('pause', () => handlers.onPause());
  // Sin "siguiente/anterior/adelantar": no tienen sentido acá y algunos sistemas los muestran igual.
  for (const a of ['previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto', 'stop'] as MediaSessionAction[]) set(a, null);
  lastText = '';
  return true;
}

/** Actualiza el panel. Es barato: solo toca el sistema si cambió el texto. */
export function updateLockScreen(s: LockScreenState): void {
  if (!audio || !lockScreenSupported()) return;
  const ms = navigator.mediaSession;
  const t = lockScreenText(s);
  const key = `${t.title}|${t.artist}`;
  if (key !== lastText) {
    lastText = key;
    try {
      ms.metadata = new MediaMetadata({
        ...t,
        artwork: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    } catch {
      /* MediaMetadata no disponible */
    }
  }
  ms.playbackState = s.running ? 'playing' : 'paused';

  // Barra de progreso del sistema: avanza sola aunque la app quede en segundo plano.
  const now = Date.now();
  if (now - lastPositionAt > 15000 || !s.running) {
    lastPositionAt = now;
    const pos = s.elapsedMs / 1000;
    const duration = Math.max(pos + 1, s.targetSeconds ?? 0, Math.ceil((pos + 1) / 1800) * 1800); // objetivo o tramos de 30 min
    try {
      ms.setPositionState?.({ duration, position: Math.min(pos, duration), playbackRate: s.running ? 1 : 0 });
    } catch {
      /* valores fuera de rango en algunos navegadores */
    }
  }
  if (s.running && audio.paused) void audio.play().catch(() => undefined);
  if (!s.running && !audio.paused) audio.pause();
}

/** Saca el panel (al terminar, descartar o salir de la pantalla). */
export function stopLockScreen(): void {
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = null;
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
  lastText = '';
  lastPositionAt = 0;
  if (!lockScreenSupported()) return;
  const ms = navigator.mediaSession;
  ms.metadata = null;
  ms.playbackState = 'none';
  for (const a of ['play', 'pause'] as MediaSessionAction[]) {
    try {
      ms.setActionHandler(a, null);
    } catch {
      /* nada */
    }
  }
}

export function lockScreenActive(): boolean {
  return !!audio;
}
