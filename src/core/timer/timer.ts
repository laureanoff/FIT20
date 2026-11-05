/**
 * Temporizadores puros y serializables.
 * El tiempo SIEMPRE se calcula con marcas de tiempo (Date.now()), nunca contando ticks de setInterval:
 * si la pantalla se bloquea o la pestaña queda en segundo plano, al volver el valor es correcto.
 * El estado se guarda en IndexedDB para sobrevivir a un cierre de la app.
 */

export type CountdownStatus = 'idle' | 'running' | 'paused' | 'done';

export interface Countdown {
  status: CountdownStatus;
  duration_ms: number;
  /** Momento absoluto de fin cuando está corriendo. */
  ends_at: number | null;
  /** Restante congelado cuando está en pausa. */
  paused_remaining_ms: number | null;
}

export function createCountdown(durationMs: number): Countdown {
  return { status: 'idle', duration_ms: Math.max(0, durationMs), ends_at: null, paused_remaining_ms: null };
}

export function startCountdown(t: Countdown, now: number): Countdown {
  return { ...t, status: 'running', ends_at: now + t.duration_ms, paused_remaining_ms: null };
}

export function remainingMs(t: Countdown, now: number): number {
  switch (t.status) {
    case 'idle': return t.duration_ms;
    case 'paused': return t.paused_remaining_ms ?? 0;
    case 'done': return 0;
    case 'running': return Math.max(0, (t.ends_at ?? now) - now);
  }
}

/** Pasa a "done" si el tiempo ya se cumplió (llamar al volver a primer plano y en cada render). */
export function tickCountdown(t: Countdown, now: number): Countdown {
  if (t.status === 'running' && remainingMs(t, now) === 0) return { ...t, status: 'done', ends_at: null };
  return t;
}

export function pauseCountdown(t: Countdown, now: number): Countdown {
  if (t.status !== 'running') return t;
  const rem = remainingMs(t, now);
  return rem === 0 ? { ...t, status: 'done', ends_at: null } : { ...t, status: 'paused', ends_at: null, paused_remaining_ms: rem };
}

export function resumeCountdown(t: Countdown, now: number): Countdown {
  if (t.status !== 'paused') return t;
  return { ...t, status: 'running', ends_at: now + (t.paused_remaining_ms ?? 0), paused_remaining_ms: null };
}

/** +15 s / −15 s. Nunca deja un valor negativo; si llega a 0 corriendo, termina. */
export function adjustCountdown(t: Countdown, deltaMs: number, now: number): Countdown {
  switch (t.status) {
    case 'idle':
      return { ...t, duration_ms: Math.max(0, t.duration_ms + deltaMs) };
    case 'paused':
      return { ...t, paused_remaining_ms: Math.max(0, (t.paused_remaining_ms ?? 0) + deltaMs) };
    case 'running': {
      const ends = Math.max(now, (t.ends_at ?? now) + deltaMs);
      return tickCountdown({ ...t, ends_at: ends }, now);
    }
    case 'done':
      return deltaMs > 0 ? { ...t, status: 'running', ends_at: now + deltaMs } : t;
  }
}

export function resetCountdown(t: Countdown, durationMs = t.duration_ms): Countdown {
  return createCountdown(durationMs);
}

// ───────── Cronómetro (running, duración de la sesión) ─────────

export type StopwatchStatus = 'idle' | 'running' | 'paused' | 'stopped';

export interface Stopwatch {
  status: StopwatchStatus;
  accumulated_ms: number;
  resumed_at: number | null;
  started_at: number | null;
}

export function createStopwatch(): Stopwatch {
  return { status: 'idle', accumulated_ms: 0, resumed_at: null, started_at: null };
}

export function elapsedMs(s: Stopwatch, now: number): number {
  return s.accumulated_ms + (s.status === 'running' && s.resumed_at !== null ? Math.max(0, now - s.resumed_at) : 0);
}

export function startStopwatch(s: Stopwatch, now: number): Stopwatch {
  if (s.status === 'running' || s.status === 'stopped') return s;
  return { ...s, status: 'running', resumed_at: now, started_at: s.started_at ?? now };
}

export function pauseStopwatch(s: Stopwatch, now: number): Stopwatch {
  if (s.status !== 'running') return s;
  return { ...s, status: 'paused', accumulated_ms: elapsedMs(s, now), resumed_at: null };
}

export function stopStopwatch(s: Stopwatch, now: number): Stopwatch {
  return { ...s, status: 'stopped', accumulated_ms: elapsedMs(s, now), resumed_at: null };
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Para mostrar una cuenta regresiva: redondea hacia arriba (9.2 s se ve como 0:10). */
export function formatCountdown(ms: number): string {
  return formatClock(Math.ceil(ms / 1000) * 1000);
}
