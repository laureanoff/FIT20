import type { BodyRegion, FitnessLevel, PrimaryGoal, RunningExperience } from '@/types/domain';

export const GOAL_LABELS: Record<PrimaryGoal, { title: string; description: string }> = {
  lose_fat: { title: 'Bajar grasa', description: 'Perder grasa conservando músculo' },
  lose_weight: { title: 'Bajar de peso', description: 'Reducir el peso corporal de forma gradual' },
  gain_muscle: { title: 'Ganar músculo', description: 'Más fuerza y masa muscular' },
  recomposition: { title: 'Recomposición', description: 'Menos grasa y más músculo a la vez' },
  endurance: { title: 'Resistencia', description: 'Correr más lejos y mejor' },
  fitness: { title: 'Ponerme en forma', description: 'Salud general, energía y movilidad' },
  maintain: { title: 'Mantenerme', description: 'Sostener lo que ya logré' },
};

export const LEVEL_LABELS: Record<FitnessLevel, { title: string; description: string }> = {
  beginner: { title: 'Principiante', description: 'Entreno poco o vuelvo después de un tiempo' },
  intermediate: { title: 'Intermedio', description: 'Entreno con regularidad hace meses' },
  advanced: { title: 'Avanzado', description: 'Entreno fuerte hace años' },
};

export const RUN_LABELS: Record<RunningExperience, { title: string; description: string }> = {
  none: { title: 'No corro', description: 'Empezamos con trote y caminata' },
  occasional: { title: 'Corro a veces', description: 'Algunas salidas al mes' },
  regular: { title: 'Corro seguido', description: 'Todas o casi todas las semanas' },
  experienced: { title: 'Corredor/a', description: 'Hice carreras o entreno con plan' },
};

export const INJURY_LABELS: Record<BodyRegion, string> = {
  shoulder: 'Hombro',
  elbow: 'Codo',
  wrist: 'Muñeca',
  lower_back: 'Zona lumbar',
  hip: 'Cadera',
  knee: 'Rodilla',
  ankle: 'Tobillo',
  neck: 'Cuello',
};

/** Lunes primero, como se usa en Argentina. Valor = día de JS (0 = domingo). */
export const WEEKDAYS: { value: number; short: string; long: string }[] = [
  { value: 1, short: 'Lu', long: 'Lunes' },
  { value: 2, short: 'Ma', long: 'Martes' },
  { value: 3, short: 'Mi', long: 'Miércoles' },
  { value: 4, short: 'Ju', long: 'Jueves' },
  { value: 5, short: 'Vi', long: 'Viernes' },
  { value: 6, short: 'Sá', long: 'Sábado' },
  { value: 0, short: 'Do', long: 'Domingo' },
];

export const DIET_PREFERENCES = ['Omnívora', 'Vegetariana', 'Vegana', 'Pescetariana', 'Baja en carbohidratos'];
export const DIET_RESTRICTIONS = ['Sin TACC (celiaquía)', 'Sin lactosa', 'Sin frutos secos', 'Sin huevo', 'Sin mariscos', 'Diabetes', 'Hipertensión'];
