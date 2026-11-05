import type { Equipment, Exercise } from '../../types/domain.ts';
import { upperBody } from './upper.ts';
import { lowerAndCore } from './lower-core.ts';
import { conditioningAndMobility } from './conditioning-mobility.ts';

export const EXERCISES: readonly Exercise[] = [...upperBody, ...lowerAndCore, ...conditioningAndMobility];

const byId = new Map(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise | undefined {
  return byId.get(id);
}

/**
 * ¿El usuario puede hacer este ejercicio con su equipamiento?
 * - El peso corporal siempre está disponible.
 * - "Gimnasio completo" cubre mancuernas, bandas y barra de dominadas.
 */
export function isAvailable(exercise: Exercise, owned: readonly Equipment[]): boolean {
  const have = new Set<Equipment>(['bodyweight', ...owned]);
  if (have.has('gym')) {
    have.add('dumbbells');
    have.add('bands');
    have.add('pullup_bar');
  }
  return exercise.equipment.some((eq) => have.has(eq));
}

export const MUSCLE_LABELS: Record<Exercise['primary_muscle'], string> = {
  chest: 'Pecho',
  back: 'Espalda',
  shoulders: 'Hombros',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  abs: 'Abdomen',
  quads: 'Cuádriceps',
  hamstrings: 'Isquiotibiales',
  glutes: 'Glúteos',
  calves: 'Gemelos',
  full_body: 'Cuerpo completo',
  mobility: 'Movilidad',
  stretching: 'Estiramientos',
  cardio: 'Cardio',
};

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  bodyweight: 'Sin equipamiento',
  dumbbells: 'Mancuernas',
  bands: 'Bandas elásticas',
  weighted_backpack: 'Mochila con peso',
  pullup_bar: 'Barra de dominadas',
  gym: 'Gimnasio completo',
};
