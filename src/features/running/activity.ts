import { Bike, Footprints, PersonStanding } from 'lucide-react';
import type { CardioActivity } from '@/types/domain';

export const ACTIVITIES: CardioActivity[] = ['run', 'walk', 'bike'];

export const ACTIVITY_LABEL: Record<CardioActivity, string> = { run: 'Running', walk: 'Caminata', bike: 'Bici' };
/** Verbo para botones: "Correr con GPS", "Caminar con GPS", "Andar en bici con GPS". */
export const ACTIVITY_VERB: Record<CardioActivity, string> = { run: 'Correr', walk: 'Caminar', bike: 'Andar en bici' };
export const ACTIVITY_NOUN: Record<CardioActivity, string> = { run: 'carrera', walk: 'caminata', bike: 'salida en bici' };
export const ACTIVITY_ICON = { run: Footprints, walk: PersonStanding, bike: Bike } as const;

export function activityOf(x: { activity?: CardioActivity | null } | null | undefined): CardioActivity {
  return x?.activity ?? 'run';
}

/** En bici se piensa en velocidad (km/h); corriendo y caminando, en ritmo (min/km). */
export const usesSpeed = (a: CardioActivity) => a === 'bike';

export function fmtSpeed(kmh: number | null): string {
  return kmh === null || !Number.isFinite(kmh) || kmh <= 0 ? '—' : kmh.toLocaleString('es-AR', { maximumFractionDigits: 1 });
}
