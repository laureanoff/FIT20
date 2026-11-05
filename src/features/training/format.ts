import type { DayStatus, PlannedExercise, SessionType } from '@/types/domain';

export const SESSION_LABELS: Record<SessionType, string> = {
  strength: 'Fuerza',
  run: 'Running',
  strength_run: 'Fuerza + trote',
  active_recovery: 'Recuperación',
  rest: 'Descanso',
};

export const STATUS_LABELS: Record<DayStatus, string> = {
  pending: 'Pendiente',
  started: 'En curso',
  completed: 'Hecho',
  skipped: 'Salteado',
};

export function prescription(pe: Pick<PlannedExercise, 'sets' | 'reps'>): string {
  return `${pe.sets} × ${pe.reps}`;
}

export function restLabel(s: number): string {
  if (s <= 0) return 'sin pausa';
  if (s < 60) return `${s} s de pausa`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}${r ? `:${String(r).padStart(2, '0')}` : ''} min de pausa`;
}

export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

export function dateLabel(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string {
  const [y, m, d] = iso.split('-').map(Number);
  const s = new Date(y!, m! - 1, d!).toLocaleDateString('es-AR', opts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Valor inicial de repeticiones a partir de la prescripción: "8-12" → 8, "10 por lado" → 10, "30 s" → 30 (segundos).
 */
export function targetFromReps(reps: string): { reps: number | null; seconds: number | null } {
  const n = Number(reps.match(/\d+/)?.[0] ?? NaN);
  if (!Number.isFinite(n)) return { reps: null, seconds: null };
  if (/\bs\b|seg|min/.test(reps)) return { reps: null, seconds: /min/.test(reps) ? n * 60 : n };
  return { reps: n, seconds: null };
}
