import { useCallback, useEffect, useRef, useState } from 'react';
import { type Countdown, adjustCountdown, createCountdown, pauseCountdown, remainingMs, resumeCountdown, startCountdown } from '@/core/timer/timer';

const KEY = 'fit20:rest-timer';

function load(): Countdown | null {
  try {
    const raw = localStorage.getItem(KEY);
    const c = raw ? (JSON.parse(raw) as Countdown) : null;
    // Si el descanso terminó mientras la app estaba cerrada, no sonar tarde.
    if (c && c.status === 'running' && (c.ends_at ?? 0) < Date.now()) return null;
    return c;
  } catch {
    return null;
  }
}

function persist(c: Countdown | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento: el temporizador igual funciona en memoria */
  }
}

let audio: AudioContext | null = null;
/** Tres pitidos cortos (no requiere archivos: funciona sin conexión). */
export function beep(): void {
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.22);
      o.stop(t0 + i * 0.22 + 0.2);
    }
  } catch {
    /* audio no disponible */
  }
}

/** Desbloquea el audio en iOS: debe llamarse dentro de un toque del usuario. */
export function primeAudio(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    /* sin audio */
  }
}

/**
 * Temporizador de descanso basado en timestamps (sobrevive a recargas y a la pantalla bloqueada:
 * al volver, el tiempo restante es el real).
 */
export function useRestTimer(opts: { sound: boolean; vibration: boolean }) {
  const [timer, setTimer] = useState<Countdown | null>(load);
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);

  useEffect(() => {
    if (!timer || timer.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer]);

  const left = timer ? remainingMs(timer, now) : 0;

  useEffect(() => {
    if (!timer || timer.status !== 'running') return;
    if (left <= 0 && !fired.current) {
      fired.current = true;
      if (opts.sound) beep();
      if (opts.vibration) navigator.vibrate?.([200, 100, 200]);
      const done = { ...timer, status: 'done' as const };
      setTimer(done);
      persist(null);
    }
  }, [left, timer, opts.sound, opts.vibration]);

  const update = useCallback((c: Countdown | null) => {
    persist(c);
    setTimer(c);
    setNow(Date.now());
  }, []);

  return {
    timer,
    left,
    start: (seconds: number) => {
      fired.current = false;
      update(startCountdown(createCountdown(seconds * 1000), Date.now()));
    },
    add: (seconds: number) => timer && update(adjustCountdown(timer, seconds * 1000, Date.now())),
    toggle: () => timer && update(timer.status === 'paused' ? resumeCountdown(timer, Date.now()) : pauseCountdown(timer, Date.now())),
    stop: () => update(null),
  };
}

/** Mantiene la pantalla encendida durante la sesión (si el navegador lo permite). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock.release();
      } catch {
        /* denegado o no soportado */
      }
    };
    const onVis = () => document.visibilityState === 'visible' && void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [active]);
}
