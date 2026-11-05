import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, parseNum, profileFields, stepErrors, validateDraft } from '@/features/profile/form';
import { greeting } from '@/features/dashboard/DashboardScreen';
import { passwordProblem } from '@/features/auth/AuthScreens';

const valid = {
  ...EMPTY_DRAFT,
  full_name: '  Lau ',
  birth_date: '1995-03-10',
  height_cm: '170',
  current_weight_kg: '72,5',
  primary_goal: 'fitness' as const,
  fitness_level: 'beginner' as const,
  running_experience: 'none' as const,
};

describe('formulario de perfil', () => {
  it('acepta coma decimal', () => {
    expect(parseNum('72,5')).toBe(72.5);
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
  });

  it('un borrador completo no tiene errores y se normaliza', () => {
    expect(validateDraft(valid, '2026-11-05')).toEqual({});
    const p = profileFields({ ...valid, training_weekdays: [5, 1, 3] });
    expect(p.full_name).toBe('Lau');
    expect(p.current_weight_kg).toBe(72.5);
    expect(p.training_weekdays).toEqual([1, 3, 5]);
    expect(p.max_run_distance_km).toBe(0);
  });

  it('respeta los mismos rangos que la base de datos', () => {
    const e = validateDraft({ ...valid, height_cm: '90', current_weight_kg: '400', training_weekdays: [], session_minutes: 10 }, '2026-11-05');
    expect(Object.keys(e).sort()).toEqual(['current_weight_kg', 'height_cm', 'session_minutes', 'training_weekdays']);
  });

  it('rechaza menores de 13 y fechas futuras', () => {
    expect(validateDraft({ ...valid, birth_date: '2020-01-01' }, '2026-11-05').birth_date).toMatch(/13 años/);
    expect(validateDraft({ ...valid, birth_date: '2030-01-01' }, '2026-11-05').birth_date).toBeDefined();
  });

  it('cada paso solo muestra sus propios errores', () => {
    expect(Object.keys(stepErrors(EMPTY_DRAFT, 'goal'))).toEqual(['primary_goal']);
  });
});

describe('textos', () => {
  it('saluda según la hora', () => {
    expect(greeting(8)).toBe('Buen día');
    expect(greeting(15)).toBe('Buenas tardes');
    expect(greeting(23)).toBe('Buenas noches');
  });

  it('exige contraseñas razonables', () => {
    expect(passwordProblem('abc')).not.toBeNull();
    expect(passwordProblem('abcdefgh')).not.toBeNull();
    expect(passwordProblem('fit20rules')).toBeNull();
  });
});
