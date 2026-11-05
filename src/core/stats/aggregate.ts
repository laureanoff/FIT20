import type { ISODate } from '../../types/domain.ts';
import { addDays, diffDays, startOfWeek } from '../utils/date.ts';

/** Suma valores por semana (lunes) entre dos fechas, incluyendo semanas vacías con 0. */
export function weeklyTotals(items: readonly { date: ISODate; value: number }[], from: ISODate, to: ISODate): { week: ISODate; value: number }[] {
  const out: { week: ISODate; value: number }[] = [];
  const idx = new Map<ISODate, number>();
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) {
    idx.set(w, out.length);
    out.push({ week: w, value: 0 });
  }
  for (const it of items) {
    const i = idx.get(startOfWeek(it.date));
    if (i !== undefined) out[i]!.value = Math.round((out[i]!.value + it.value) * 100) / 100;
  }
  return out;
}

export function monthlyTotals(items: readonly { date: ISODate; value: number }[]): { month: string; value: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.date.slice(0, 7), (m.get(it.date.slice(0, 7)) ?? 0) + it.value);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value: Math.round(value * 100) / 100 }));
}

/**
 * Racha de actividad: días consecutivos hasta hoy con al menos una actividad.
 * Los días de descanso PLANIFICADOS no cortan la racha (descansar es parte del plan).
 * Si hoy todavía no se entrenó, la racha cuenta hasta ayer.
 */
export function activityStreak(activeDates: ReadonlySet<ISODate>, today: ISODate, plannedRest: ReadonlySet<ISODate> = new Set()): number {
  let streak = 0;
  let d = activeDates.has(today) ? today : addDays(today, -1);
  for (let guard = 0; guard < 3650; guard++) {
    if (activeDates.has(d)) streak++;
    else if (!plannedRest.has(d)) break;
    d = addDays(d, -1);
  }
  return streak;
}

/** Progreso hacia el peso objetivo en 0–1 (funciona para bajar o subir de peso). */
export function goalProgress(start: number, current: number, target: number): number {
  if (start === target) return 1;
  const p = (start - current) / (start - target);
  return Math.max(0, Math.min(1, p));
}

/** Consistencia semanal: sesiones completadas / planificadas (0–1) por semana. */
export function weeklyConsistency(planned: readonly { date: ISODate; done: boolean }[]): { week: ISODate; ratio: number }[] {
  const m = new Map<ISODate, { done: number; total: number }>();
  for (const p of planned) {
    const w = startOfWeek(p.date);
    const v = m.get(w) ?? { done: 0, total: 0 };
    v.total++;
    if (p.done) v.done++;
    m.set(w, v);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ratio: v.total ? v.done / v.total : 0 }));
}

/** Valor más cercano (anterior o igual) a una fecha: para comparar dos fechas de medidas. */
export function valueAt<T extends { date: ISODate }>(series: readonly T[], date: ISODate): T | null {
  let best: T | null = null;
  for (const s of series) if (diffDays(s.date, date) >= 0 && (!best || s.date > best.date)) best = s;
  return best;
}
