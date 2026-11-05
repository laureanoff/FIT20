import { ageFromBirthDate, localToday } from '@/core/utils/date';
import type { BodyRegion, Equipment, FitnessLevel, PrimaryGoal, Profile, RunningExperience, Sex } from '@/types/domain';

/** Borrador editable del perfil: los números se editan como texto para no pelear con el teclado. */
export interface ProfileDraft {
  full_name: string;
  birth_date: string;
  sex: Sex | null;
  height_cm: string;
  current_weight_kg: string;
  target_weight_kg: string;
  primary_goal: PrimaryGoal | null;
  fitness_level: FitnessLevel | null;
  running_experience: RunningExperience | null;
  max_run_distance_km: string;
  training_weekdays: number[];
  session_minutes: number;
  equipment: Equipment[];
  injuries: BodyRegion[];
  dietary_preferences: string[];
  dietary_restrictions: string[];
}

export type DraftErrors = Partial<Record<keyof ProfileDraft, string>>;

export const EMPTY_DRAFT: ProfileDraft = {
  full_name: '',
  birth_date: '',
  sex: null,
  height_cm: '',
  current_weight_kg: '',
  target_weight_kg: '',
  primary_goal: null,
  fitness_level: null,
  running_experience: null,
  max_run_distance_km: '',
  training_weekdays: [1, 3, 5],
  session_minutes: 45,
  equipment: ['bodyweight'],
  injuries: [],
  dietary_preferences: [],
  dietary_restrictions: [],
};

/** Acepta coma decimal ("72,5"). */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function draftFromProfile(p: Profile): ProfileDraft {
  const str = (n: number | null) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
  return {
    full_name: p.full_name,
    birth_date: p.birth_date ?? '',
    sex: p.sex,
    height_cm: str(p.height_cm),
    current_weight_kg: str(p.current_weight_kg),
    target_weight_kg: str(p.target_weight_kg),
    primary_goal: p.primary_goal,
    fitness_level: p.fitness_level,
    running_experience: p.running_experience,
    max_run_distance_km: p.max_run_distance_km ? str(p.max_run_distance_km) : '',
    training_weekdays: [...p.training_weekdays],
    session_minutes: p.session_minutes,
    equipment: [...p.equipment],
    injuries: [...p.injuries],
    dietary_preferences: [...p.dietary_preferences],
    dietary_restrictions: [...p.dietary_restrictions],
  };
}

/** Pasos del onboarding: cada uno valida solo sus campos. */
export const STEP_FIELDS = {
  about: ['full_name', 'birth_date', 'sex', 'height_cm', 'current_weight_kg', 'target_weight_kg'],
  goal: ['primary_goal'],
  experience: ['fitness_level', 'running_experience', 'max_run_distance_km'],
  schedule: ['training_weekdays', 'session_minutes'],
  equipment: ['equipment', 'injuries'],
  food: ['dietary_preferences', 'dietary_restrictions'],
} as const satisfies Record<string, readonly (keyof ProfileDraft)[]>;

/** Mismas reglas que los CHECK de la tabla `profiles`, con mensajes claros. */
export function validateDraft(d: ProfileDraft, today = localToday()): DraftErrors {
  const e: DraftErrors = {};
  const name = d.full_name.trim();
  if (!name) e.full_name = 'Contanos cómo te llamás.';
  else if (name.length > 80) e.full_name = 'Máximo 80 caracteres.';

  if (!d.birth_date) e.birth_date = 'Necesitamos tu fecha de nacimiento para estimar tus necesidades.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(d.birth_date) || d.birth_date < '1900-01-01' || d.birth_date > today) e.birth_date = 'Revisá la fecha.';
  else {
    const age = ageFromBirthDate(d.birth_date, today);
    if (age < 13) e.birth_date = 'FIT 20 es para personas de 13 años o más.';
  }

  const h = parseNum(d.height_cm);
  if (h === null) e.height_cm = 'Ingresá tu altura.';
  else if (h < 100 || h > 250) e.height_cm = 'Entre 100 y 250 cm.';

  const w = parseNum(d.current_weight_kg);
  if (w === null) e.current_weight_kg = 'Ingresá tu peso.';
  else if (w < 25 || w > 350) e.current_weight_kg = 'Entre 25 y 350 kg.';

  if (d.target_weight_kg.trim()) {
    const t = parseNum(d.target_weight_kg);
    if (t === null || t < 25 || t > 350) e.target_weight_kg = 'Entre 25 y 350 kg, o dejalo vacío.';
  }

  if (!d.primary_goal) e.primary_goal = 'Elegí un objetivo.';
  if (!d.fitness_level) e.fitness_level = 'Elegí tu nivel.';
  if (!d.running_experience) e.running_experience = 'Elegí tu experiencia corriendo.';

  if (d.max_run_distance_km.trim()) {
    const r = parseNum(d.max_run_distance_km);
    if (r === null || r < 0 || r > 100) e.max_run_distance_km = 'Entre 0 y 100 km.';
  }

  if (d.training_weekdays.length === 0) e.training_weekdays = 'Elegí al menos un día.';
  if (d.session_minutes < 15 || d.session_minutes > 180) e.session_minutes = 'Entre 15 y 180 minutos.';
  if (d.equipment.length === 0) e.equipment = 'Elegí al menos una opción (peso corporal siempre vale).';
  return e;
}

export function stepErrors(d: ProfileDraft, step: keyof typeof STEP_FIELDS): DraftErrors {
  const all = validateDraft(d);
  const out: DraftErrors = {};
  for (const f of STEP_FIELDS[step]) if (all[f]) out[f] = all[f];
  return out;
}

/** Convierte un borrador válido en los campos del perfil. */
export function profileFields(d: ProfileDraft): Omit<Profile, 'id' | 'version' | 'updated_at' | 'deleted_at' | 'onboarding_completed'> {
  const runExp = d.running_experience ?? 'none';
  return {
    full_name: d.full_name.trim(),
    birth_date: d.birth_date || null,
    sex: d.sex,
    height_cm: parseNum(d.height_cm)!,
    current_weight_kg: parseNum(d.current_weight_kg)!,
    target_weight_kg: parseNum(d.target_weight_kg),
    primary_goal: d.primary_goal ?? 'fitness',
    fitness_level: d.fitness_level ?? 'beginner',
    running_experience: runExp,
    max_run_distance_km: runExp === 'none' ? 0 : (parseNum(d.max_run_distance_km) ?? 0),
    training_weekdays: [...d.training_weekdays].sort((a, b) => a - b),
    session_minutes: d.session_minutes,
    equipment: d.equipment,
    injuries: d.injuries,
    dietary_preferences: d.dietary_preferences,
    dietary_restrictions: d.dietary_restrictions,
  };
}

export function toggle<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}
