import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useData, useProfile } from '@/app/data';
import { alive } from '@/lib/db/database';
import { energyFor } from '@/features/profile/energy';
import { customFoods, resolveTargets, totalsOf } from './actions';

export function useDayLog(date: string) {
  const { db } = useData();
  return useLiveQuery(async () => {
    const logs = (await db.food_logs.where('log_date').equals(date).toArray()).filter(alive).sort((a, b) => a.logged_at.localeCompare(b.logged_at));
    const water = (await db.water_logs.where('log_date').equals(date).toArray()).filter(alive).sort((a, b) => a.logged_at.localeCompare(b.logged_at));
    return { logs, water, totals: totalsOf(logs), water_ml: water.reduce((a, w) => a + w.quantity_ml, 0) };
  }, [db, date]);
}

export function useCustomFoods() {
  const { db, userId } = useData();
  return useLiveQuery(() => customFoods(db, userId), [db, userId]);
}

export function useSavedMeals() {
  const { db } = useData();
  return useLiveQuery(async () => (await db.saved_meals.toArray()).filter(alive).sort((a, b) => a.name.localeCompare(b.name, 'es')), [db]);
}

/** Últimos registros (para "frecuentes"). */
export function useRecentLogs(limitDays = 60) {
  const { db } = useData();
  return useLiveQuery(async () => {
    const since = new Date(Date.now() - limitDays * 86_400_000).toISOString().slice(0, 10);
    return (await db.food_logs.where('log_date').aboveOrEqual(since).toArray()).filter(alive);
  }, [db, limitDays]);
}

export function useTargets() {
  const profile = useProfile();
  const { settings } = useData();
  return useMemo(() => resolveTargets(settings.nutrition_targets, energyFor(profile)), [settings.nutrition_targets, profile]);
}
