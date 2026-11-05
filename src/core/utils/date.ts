import type { ISODate } from '../../types/domain.ts';

/**
 * Fechas de calendario como strings YYYY-MM-DD, operadas en UTC para que la
 * planificación no se corra un día por zona horaria o cambio de horario.
 */

export function parseISODate(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) throw new Error(`Fecha inválida: ${d}`);
  return new Date(Date.UTC(y, m - 1, day));
}

export function toISODate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = parseISODate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISODate(dt);
}

/** 0 = domingo … 6 = sábado */
export function weekday(d: ISODate): number {
  return parseISODate(d).getUTCDay();
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** Fecha local del dispositivo (no UTC) en formato YYYY-MM-DD. */
export function localToday(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function ageFromBirthDate(birth: ISODate, today: ISODate): number {
  const b = parseISODate(birth);
  const t = parseISODate(today);
  let age = t.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Lunes de la semana de la fecha dada (semana ISO). */
export function startOfWeek(d: ISODate): ISODate {
  const wd = weekday(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}
