/**
 * Avisos por voz durante la salida (cada km; en bici cada 5 km).
 * Usan la voz del sistema: no necesitan internet y, en vez de cortar la música, la bajan un momento.
 */

export type CardioAudioMode = 'music' | 'lock';

const MODE_KEY = 'fit20:cardio-audio';
const VOICE_KEY = 'fit20:voice';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* opcional */
  }
}

/** "music": tu música sigue sonando (por defecto). "lock": km y tiempo en la pantalla bloqueada (pausa la música de otras apps). */
export function cardioAudioMode(): CardioAudioMode {
  const v = read(MODE_KEY);
  if (v === 'lock' || v === 'music') return v;
  return read('fit20:lockscreen') === '1' ? 'lock' : 'music';
}
export function setCardioAudioMode(m: CardioAudioMode): void {
  write(MODE_KEY, m);
}

export const voiceSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
export const voiceEnabled = (): boolean => read(VOICE_KEY) !== '0';
export const setVoiceEnabled = (on: boolean): void => write(VOICE_KEY, on ? '1' : '0');

type Act = 'run' | 'walk' | 'bike';

/** Cada cuántos km se avisa. */
export const announceEvery = (a: Act): number => (a === 'bike' ? 5 : 1);

function spokenDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} ${h === 1 ? 'hora' : 'horas'}`);
  if (m || h) parts.push(`${m} ${m === 1 ? 'minuto' : 'minutos'}`);
  if (!h && ss) parts.push(`${ss} ${ss === 1 ? 'segundo' : 'segundos'}`);
  return parts.join(' ') || '0 segundos';
}

function spokenPace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return ss ? `${m} ${ss < 10 ? `cero ${ss}` : ss}` : `${m} minutos`;
}

/**
 * Texto del aviso. lastSegmentSeconds: lo que tardaste el último km (o los últimos 5 km en bici).
 * Ej.: "Kilómetro 3. Tiempo: 17 minutos 5 segundos. Último kilómetro a 5 40."
 */
export function splitPhrase(a: Act, km: number, elapsedSeconds: number, lastSegmentSeconds: number): string {
  const head = `Kilómetro ${km}. Tiempo: ${spokenDuration(elapsedSeconds)}.`;
  if (a === 'bike') {
    const kmh = Math.round((announceEvery('bike') * 3600) / Math.max(1, lastSegmentSeconds));
    return `${head} Velocidad: ${kmh} kilómetros por hora.`;
  }
  return `${head} Último kilómetro a ${spokenPace(lastSegmentSeconds)}.`;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'es-AR') ?? voices.find((v) => v.lang === 'es-US' || v.lang === 'es-MX') ?? voices.find((v) => v.lang.startsWith('es')) ?? null;
}

/** iOS exige que la primera vez la voz arranque con un toque: se llama al tocar Empezar. */
export function primeVoice(): void {
  if (!voiceSupported() || !voiceEnabled()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* nada */
  }
}

export function speak(text: string): boolean {
  if (!voiceSupported() || !voiceEnabled()) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-AR';
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}
