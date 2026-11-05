import { type EnergyResult, estimateEnergy } from '@/core/nutrition/energy';
import { ageFromBirthDate, localToday } from '@/core/utils/date';
import type { Profile } from '@/types/domain';

type EnergyFields = Pick<Profile, 'birth_date' | 'sex' | 'height_cm' | 'current_weight_kg' | 'training_weekdays' | 'session_minutes' | 'primary_goal'>;

export function energyFor(p: EnergyFields, today = localToday()): EnergyResult {
  return estimateEnergy({
    age: p.birth_date ? ageFromBirthDate(p.birth_date, today) : null,
    sex: p.sex,
    height_cm: p.height_cm,
    weight_kg: p.current_weight_kg,
    weekly_training_minutes: p.training_weekdays.length * p.session_minutes,
    goal: p.primary_goal,
  });
}
