import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useData } from '@/app/data';
import { localToday } from '@/core/utils/date';
import { alive } from '@/lib/db/database';
import type { Ctx } from './actions';

export function useCtx(): Ctx {
  const { db, userId, sync } = useData();
  return useMemo(() => ({ db, userId, changed: () => sync.schedule() }), [db, userId, sync]);
}

/** Plan vigente (activo o pausado). undefined = cargando, null = no hay. */
export function useActivePlan() {
  const { db } = useData();
  return useLiveQuery(async () => {
    const plans = (await db.training_plans.where('status').anyOf('active', 'paused').toArray()).filter(alive);
    plans.sort((a, b) => b.start_date.localeCompare(a.start_date));
    return plans[0] ?? null;
  }, [db]);
}

export function usePlanDays(planId: string | undefined) {
  const { db } = useData();
  return useLiveQuery(async () => {
    if (!planId) return [];
    return (await db.training_days.where('plan_id').equals(planId).toArray()).filter(alive).sort((a, b) => a.day_number - b.day_number);
  }, [db, planId]);
}

export function useDay(dayId: string | undefined) {
  const { db } = useData();
  return useLiveQuery(async () => (dayId ? ((await db.training_days.get(dayId)) ?? null) : null), [db, dayId]);
}

/** Día del plan activo para hoy (o null si no hay plan o hoy está fuera del plan). */
export function useTodayDay() {
  const { db } = useData();
  const today = localToday();
  return useLiveQuery(async () => {
    const plans = (await db.training_plans.where('status').equals('active').toArray()).filter(alive);
    for (const p of plans) {
      const d = (await db.training_days.where('[plan_id+date]').equals([p.id, today]).toArray()).find(alive);
      if (d) return d;
    }
    return null;
  }, [db, today]);
}

/** Entrenamiento en curso (para retomarlo al volver a la app). */
export function useOpenWorkout() {
  const { db } = useData();
  return useLiveQuery(async () => (await db.workouts.where('status').equals('started').toArray()).filter(alive).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null, [db]);
}

export function useFavorites() {
  const { db } = useData();
  return useLiveQuery(async () => new Set((await db.exercise_favorites.toArray()).filter(alive).map((f) => f.exercise_id)), [db]);
}
