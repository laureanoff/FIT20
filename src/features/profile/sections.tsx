import { Activity, Dumbbell, Flame, HeartPulse, Scale, Sparkles, Timer, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Chip, Field, OptionCard, Segmented, cx } from '@/components/ui';
import { DIET_PREFERENCES, DIET_RESTRICTIONS, GOAL_LABELS, INJURY_LABELS, LEVEL_LABELS, RUN_LABELS, WEEKDAYS } from '@/app/labels';
import { EQUIPMENT_LABELS } from '@/data/exercises';
import type { BodyRegion, Equipment, FitnessLevel, PrimaryGoal, RunningExperience } from '@/types/domain';
import { type DraftErrors, type ProfileDraft, toggle } from './form';

export interface SectionProps {
  draft: ProfileDraft;
  set: (patch: Partial<ProfileDraft>) => void;
  errors: DraftErrors;
}

function Group({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-[13px] font-medium text-muted">{label}</legend>
      {children}
      {error ? <p className="text-[13px] text-danger">{error}</p> : hint ? <p className="text-[13px] text-faint">{hint}</p> : null}
    </fieldset>
  );
}

export function AboutSection({ draft, set, errors }: SectionProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Nombre" autoComplete="given-name" value={draft.full_name} maxLength={80} onChange={(e) => set({ full_name: e.target.value })} error={errors.full_name} />
      <Field label="Fecha de nacimiento" type="date" value={draft.birth_date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set({ birth_date: e.target.value })} error={errors.birth_date} />
      <Group label="Sexo biológico (opcional)" hint="Solo se usa para estimar tu gasto energético. Si preferís no decirlo, te mostramos un rango.">
        <Segmented
          label="Sexo biológico"
          value={draft.sex ?? 'none'}
          onChange={(v) => set({ sex: v === 'none' ? null : v })}
          options={[
            { value: 'female', label: 'Femenino' },
            { value: 'male', label: 'Masculino' },
            { value: 'none', label: 'Prefiero no decir' },
          ]}
        />
      </Group>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Altura" inputMode="decimal" suffix="cm" placeholder="170" value={draft.height_cm} onChange={(e) => set({ height_cm: e.target.value })} error={errors.height_cm} />
        <Field label="Peso actual" inputMode="decimal" suffix="kg" placeholder="72,5" value={draft.current_weight_kg} onChange={(e) => set({ current_weight_kg: e.target.value })} error={errors.current_weight_kg} />
      </div>
      <Field label="Peso objetivo (opcional)" inputMode="decimal" suffix="kg" value={draft.target_weight_kg} onChange={(e) => set({ target_weight_kg: e.target.value })} error={errors.target_weight_kg} />
    </div>
  );
}

const GOAL_ICONS: Record<PrimaryGoal, ReactNode> = {
  lose_fat: <Flame className="size-5" />,
  lose_weight: <Scale className="size-5" />,
  gain_muscle: <Dumbbell className="size-5" />,
  recomposition: <Sparkles className="size-5" />,
  endurance: <Activity className="size-5" />,
  fitness: <HeartPulse className="size-5" />,
  maintain: <TrendingUp className="size-5" />,
};

export function GoalSection({ draft, set, errors }: SectionProps) {
  return (
    <div role="radiogroup" aria-label="Objetivo principal" className="flex flex-col gap-2.5">
      {(Object.keys(GOAL_LABELS) as PrimaryGoal[]).map((g) => (
        <OptionCard key={g} selected={draft.primary_goal === g} onClick={() => set({ primary_goal: g })} title={GOAL_LABELS[g].title} description={GOAL_LABELS[g].description} icon={GOAL_ICONS[g]} />
      ))}
      {errors.primary_goal && <p className="text-[13px] text-danger">{errors.primary_goal}</p>}
    </div>
  );
}

export function ExperienceSection({ draft, set, errors }: SectionProps) {
  return (
    <div className="flex flex-col gap-7">
      <Group label="Nivel de entrenamiento" error={errors.fitness_level}>
        <div role="radiogroup" aria-label="Nivel" className="flex flex-col gap-2.5">
          {(Object.keys(LEVEL_LABELS) as FitnessLevel[]).map((l) => (
            <OptionCard key={l} selected={draft.fitness_level === l} onClick={() => set({ fitness_level: l })} title={LEVEL_LABELS[l].title} description={LEVEL_LABELS[l].description} />
          ))}
        </div>
      </Group>
      <Group label="Experiencia corriendo" error={errors.running_experience}>
        <div role="radiogroup" aria-label="Experiencia corriendo" className="grid grid-cols-2 gap-2.5">
          {(Object.keys(RUN_LABELS) as RunningExperience[]).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={draft.running_experience === r}
              onClick={() => set({ running_experience: r })}
              className={cx('rounded-2xl border p-3.5 text-left', draft.running_experience === r ? 'border-accent bg-accent/10' : 'border-line bg-surface')}
            >
              <span className="block text-[15px] font-semibold">{RUN_LABELS[r].title}</span>
              <span className="block text-[12px] leading-snug text-muted">{RUN_LABELS[r].description}</span>
            </button>
          ))}
        </div>
      </Group>
      {draft.running_experience && draft.running_experience !== 'none' && (
        <Field
          label="¿Cuánto corrés hoy sin parar?"
          inputMode="decimal"
          suffix="km"
          placeholder="5"
          hint="Tu distancia máxima reciente. El plan arranca un poco por debajo."
          value={draft.max_run_distance_km}
          onChange={(e) => set({ max_run_distance_km: e.target.value })}
          error={errors.max_run_distance_km}
        />
      )}
    </div>
  );
}

const MINUTE_OPTIONS = [20, 30, 45, 60, 75, 90];

export function ScheduleSection({ draft, set, errors }: SectionProps) {
  const n = draft.training_weekdays.length;
  return (
    <div className="flex flex-col gap-7">
      <Group
        label="¿Qué días podés entrenar?"
        error={errors.training_weekdays}
        hint={n === 7 ? 'Siempre dejamos al menos un día de descanso completo: algunos días serán de recuperación activa.' : `${n} ${n === 1 ? 'día' : 'días'} por semana.`}
      >
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((d) => {
            const on = draft.training_weekdays.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={on}
                aria-label={d.long}
                onClick={() => set({ training_weekdays: toggle(draft.training_weekdays, d.value) })}
                className={cx('aspect-square rounded-xl text-[14px] font-semibold', on ? 'bg-accent text-accent-ink' : 'border border-line bg-surface text-muted')}
              >
                {d.short}
              </button>
            );
          })}
        </div>
      </Group>
      <Group label="Tiempo por sesión" error={errors.session_minutes}>
        <div className="grid grid-cols-3 gap-2">
          {MINUTE_OPTIONS.map((m) => (
            <Chip key={m} selected={draft.session_minutes === m} onClick={() => set({ session_minutes: m })}>
              <span className="inline-flex items-center gap-1.5">
                <Timer className="size-3.5" aria-hidden />
                {m} min
              </span>
            </Chip>
          ))}
        </div>
      </Group>
    </div>
  );
}

const EQUIPMENT_ORDER: Equipment[] = ['bodyweight', 'dumbbells', 'bands', 'pullup_bar', 'weighted_backpack', 'gym'];

export function EquipmentSection({ draft, set, errors }: SectionProps) {
  return (
    <div className="flex flex-col gap-7">
      <Group label="¿Con qué contás para entrenar?" error={errors.equipment}>
        <div className="flex flex-wrap gap-2">
          {EQUIPMENT_ORDER.map((eq) => (
            <Chip key={eq} selected={draft.equipment.includes(eq)} onClick={() => set({ equipment: toggle(draft.equipment, eq) })}>
              {EQUIPMENT_LABELS[eq]}
            </Chip>
          ))}
        </div>
      </Group>
      <Group label="¿Tenés alguna molestia o lesión?" hint="Evitamos los ejercicios que cargan esas zonas. Ante dolor persistente, consultá a un profesional de la salud.">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(INJURY_LABELS) as BodyRegion[]).map((r) => (
            <Chip key={r} selected={draft.injuries.includes(r)} onClick={() => set({ injuries: toggle(draft.injuries, r) })}>
              {INJURY_LABELS[r]}
            </Chip>
          ))}
        </div>
      </Group>
    </div>
  );
}

export function FoodSection({ draft, set }: SectionProps) {
  return (
    <div className="flex flex-col gap-7">
      <Group label="Tipo de alimentación">
        <div className="flex flex-wrap gap-2">
          {DIET_PREFERENCES.map((p) => (
            <Chip key={p} selected={draft.dietary_preferences.includes(p)} onClick={() => set({ dietary_preferences: toggle(draft.dietary_preferences, p) })}>
              {p}
            </Chip>
          ))}
        </div>
      </Group>
      <Group label="Restricciones o condiciones" hint="Opcional. Si tenés una condición médica, seguí las indicaciones de tu profesional.">
        <div className="flex flex-wrap gap-2">
          {DIET_RESTRICTIONS.map((r) => (
            <Chip key={r} selected={draft.dietary_restrictions.includes(r)} onClick={() => set({ dietary_restrictions: toggle(draft.dietary_restrictions, r) })}>
              {r}
            </Chip>
          ))}
        </div>
      </Group>
    </div>
  );
}
