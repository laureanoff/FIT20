import type { PrimaryGoal, Sex } from '../../types/domain.ts';

/**
 * Estimaciones energéticas ORIENTATIVAS (ecuación de Mifflin-St Jeor).
 * Reglas de seguridad:
 * - Sin edad, altura o peso no se calcula nada.
 * - Sin sexo biológico se informa un rango (no se asume uno).
 * - Menores de 18: solo mantenimiento, sin déficit, y sugerencia de consulta profesional.
 * - El déficit nunca supera 500 kcal ni deja el objetivo por debajo del metabolismo basal.
 */

export interface EnergyInput {
  age: number | null;
  sex: Sex | null;
  height_cm: number | null;
  weight_kg: number | null;
  weekly_training_minutes: number;
  goal: PrimaryGoal;
}

export interface EnergyEstimate {
  status: 'ok';
  bmr: number;
  tdee: number;
  target_kcal: number;
  /** Presente cuando falta el sexo biológico: el objetivo real cae en este rango. */
  target_range: [number, number] | null;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  water_ml: number;
  activity_factor: number;
  notes: string[];
}

export type EnergyResult = EnergyEstimate | { status: 'insufficient'; missing: string[] };

export function mifflinStJeor(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

export function activityFactor(weeklyMinutes: number): number {
  if (weeklyMinutes < 60) return 1.2;
  if (weeklyMinutes < 150) return 1.375;
  if (weeklyMinutes < 300) return 1.55;
  return 1.725;
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

const GOAL_ADJUST: Record<PrimaryGoal, number> = {
  lose_fat: -0.15,
  lose_weight: -0.15,
  recomposition: -0.05,
  gain_muscle: 0.1,
  endurance: 0,
  fitness: 0,
  maintain: 0,
};

const PROTEIN_PER_KG: Record<PrimaryGoal, number> = {
  lose_fat: 1.8,
  lose_weight: 1.6,
  recomposition: 1.8,
  gain_muscle: 1.8,
  endurance: 1.4,
  fitness: 1.4,
  maintain: 1.2,
};

const round = (n: number, step = 1) => Math.round(n / step) * step;

export function estimateEnergy(input: EnergyInput): EnergyResult {
  const missing: string[] = [];
  if (!input.age || input.age < 10 || input.age > 110) missing.push('edad');
  if (!input.height_cm || input.height_cm < 100 || input.height_cm > 250) missing.push('altura');
  if (!input.weight_kg || input.weight_kg < 25 || input.weight_kg > 350) missing.push('peso');
  if (missing.length) return { status: 'insufficient', missing };

  const age = input.age!;
  const w = input.weight_kg!;
  const h = input.height_cm!;
  const notes: string[] = ['Estimación aproximada: el gasto real varía entre personas. Ajustá según tu evolución de 2–3 semanas.'];

  const bmrFor = (s: Sex) => mifflinStJeor(s, w, h, age);
  const bmrs = input.sex ? [bmrFor(input.sex)] : [bmrFor('female'), bmrFor('male')];
  const bmrLow = Math.min(...bmrs);
  const bmrHigh = Math.max(...bmrs);
  const bmrMid = (bmrLow + bmrHigh) / 2;
  if (!input.sex) notes.push('Sin sexo biológico la ecuación da un rango; usamos el punto medio. Podés ajustar el objetivo a mano.');

  const af = activityFactor(input.weekly_training_minutes);
  const minor = age < 18;
  let adjust = GOAL_ADJUST[input.goal];
  if (minor) {
    adjust = 0;
    notes.push('Para menores de 18 años no se proponen déficits calóricos: consultá a un profesional de la nutrición.');
  }

  const targetFor = (bmr: number) => {
    const tdee = bmr * af;
    let delta = tdee * adjust;
    if (delta < 0) delta = Math.max(delta, -500);
    if (delta > 0) delta = Math.min(delta, 350);
    // Nunca por debajo del metabolismo basal.
    return Math.max(tdee + delta, bmr);
  };

  const target = targetFor(bmrMid);
  const range: [number, number] | null = input.sex ? null : [round(targetFor(bmrLow), 10), round(targetFor(bmrHigh), 10)];

  // Proteína por kg; con IMC ≥ 30 se usa el peso de referencia (IMC 25) para no sobreestimar.
  const refWeight = bmi(w, h) >= 30 ? 25 * (h / 100) ** 2 : w;
  const protein = refWeight * PROTEIN_PER_KG[input.goal];
  const fat = Math.max(0.6 * refWeight, (target * 0.27) / 9);
  const carbs = Math.max(0, (target - protein * 4 - fat * 9) / 4);

  if (adjust < 0) notes.push('El déficit está limitado a 500 kcal/día y nunca baja de tu metabolismo basal.');

  return {
    status: 'ok',
    bmr: round(bmrMid),
    tdee: round(bmrMid * af),
    target_kcal: round(target, 10),
    target_range: range,
    protein_g: round(protein),
    fat_g: round(fat),
    carbs_g: round(carbs),
    water_ml: round(w * 35, 50),
    activity_factor: af,
    notes,
  };
}
