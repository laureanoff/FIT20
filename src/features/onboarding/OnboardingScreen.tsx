import { ArrowLeft, Check } from 'lucide-react';
import { type ComponentType, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorBox, Wordmark, cx } from '@/components/ui';
import { useData } from '@/app/data';
import { GOAL_LABELS, LEVEL_LABELS, WEEKDAYS } from '@/app/labels';
import { ageFromBirthDate, localToday } from '@/core/utils/date';
import { energyFor } from '@/features/profile/energy';
import { type DraftErrors, EMPTY_DRAFT, type ProfileDraft, STEP_FIELDS, draftFromProfile, profileFields, stepErrors } from '@/features/profile/form';
import { AboutSection, EquipmentSection, ExperienceSection, FoodSection, GoalSection, ScheduleSection, type SectionProps } from '@/features/profile/sections';

type StepKey = keyof typeof STEP_FIELDS | 'summary';

const STEPS: { key: StepKey; title: string; subtitle: string; Body?: ComponentType<SectionProps> }[] = [
  { key: 'about', title: 'Contanos de vos', subtitle: 'Con esto calculamos tus referencias de energía y progreso.', Body: AboutSection },
  { key: 'goal', title: '¿Cuál es tu objetivo?', subtitle: 'Elegí el principal. Podés cambiarlo cuando quieras.', Body: GoalSection },
  { key: 'experience', title: 'Tu experiencia', subtitle: 'Así el plan arranca en el punto justo, sin quedarse corto ni pasarse.', Body: ExperienceSection },
  { key: 'schedule', title: 'Tu semana', subtitle: 'Entrenamos solo los días que elijas.', Body: ScheduleSection },
  { key: 'equipment', title: 'Equipamiento y cuidados', subtitle: 'Armamos los ejercicios con lo que tenés.', Body: EquipmentSection },
  { key: 'food', title: 'Tu alimentación', subtitle: 'Para sugerencias que te sirvan de verdad.', Body: FoodSection },
  { key: 'summary', title: 'Todo listo', subtitle: 'Revisá el resumen. Estas referencias son orientativas.' },
];

const DRAFT_KEY = 'fit20:onboarding-draft';

function loadDraft(): { draft: ProfileDraft; step: number } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as { draft: ProfileDraft; step: number }) : null;
  } catch {
    return null;
  }
}

export function OnboardingScreen() {
  const { profile, userId, saveProfile, saveSettings, settings } = useData();
  const navigate = useNavigate();
  const saved = useMemo(loadDraft, []);
  const [draft, setDraft] = useState<ProfileDraft>(() => saved?.draft ?? (profile ? draftFromProfile(profile) : EMPTY_DRAFT));
  const [step, setStep] = useState(saved?.step ?? 0);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, step }));
    } catch {
      /* sin almacenamiento de sesión: el borrador solo vive en memoria */
    }
  }, [draft, step]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const current = STEPS[step]!;
  const set = (patch: Partial<ProfileDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k as keyof ProfileDraft];
      return next;
    });
  };

  function next() {
    if (current.key !== 'summary') {
      const errs = stepErrors(draft, current.key);
      setErrors(errs);
      if (Object.keys(errs).length) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function finish() {
    setBusy(true);
    setSaveError(null);
    try {
      await saveProfile({ id: userId, ...profileFields(draft), onboarding_completed: true });
      await saveSettings({ theme: settings.theme });
      sessionStorage.removeItem(DRAFT_KEY);
      navigate('/', { replace: true });
    } catch (e) {
      setSaveError(`No se pudo guardar en este dispositivo (${e instanceof Error ? e.message : 'error desconocido'}). Revisá que el navegador no esté en modo privado.`);
      setBusy(false);
    }
  }

  const Body = current.Body;
  return (
    <main className="pt-safe mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
      <header className="flex items-center justify-between pt-4 pb-3">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          aria-label="Paso anterior"
          className={cx('-ml-2 grid size-11 place-items-center rounded-full text-muted', step === 0 && 'invisible')}
        >
          <ArrowLeft className="size-5" />
        </button>
        <Wordmark className="text-[17px]" />
        <span className="num w-11 text-right text-[13px] text-muted">
          {step + 1}/{STEPS.length}
        </span>
      </header>
      <div className="h-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <h1 className="mt-7 text-[26px] leading-tight font-bold tracking-tight">{current.title}</h1>
      <p className="mt-1.5 mb-7 text-[15px] text-muted">{current.subtitle}</p>

      <div className="flex-1 pb-6">{Body ? <Body draft={draft} set={set} errors={errors} /> : <Summary draft={draft} />}</div>

      <div className="pb-safe sticky bottom-0 -mx-5 bg-gradient-to-t from-bg from-70% to-transparent px-5 pt-6 pb-5">
        {saveError && (
          <div className="mb-3">
            <ErrorBox>{saveError}</ErrorBox>
          </div>
        )}
        {current.key === 'summary' ? (
          <Button className="w-full" onClick={finish} loading={busy}>
            <Check className="size-4" aria-hidden /> Empezar
          </Button>
        ) : (
          <Button className="w-full" onClick={next}>
            Continuar
          </Button>
        )}
      </div>
    </main>
  );
}

function Summary({ draft }: { draft: ProfileDraft }) {
  const p = profileFields(draft);
  const energy = energyFor(p);
  const age = p.birth_date ? ageFromBirthDate(p.birth_date, localToday()) : null;
  const days = WEEKDAYS.filter((d) => p.training_weekdays.includes(d.value)).map((d) => d.short);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-line bg-line">
        {[
          ['Objetivo', GOAL_LABELS[p.primary_goal].title],
          ['Nivel', LEVEL_LABELS[p.fitness_level].title],
          ['Días', days.join(' · ')],
          ['Sesión', `${p.session_minutes} min`],
          ['Peso', `${String(p.current_weight_kg).replace('.', ',')} kg`],
          ['Objetivo de peso', p.target_weight_kg ? `${String(p.target_weight_kg).replace('.', ',')} kg` : '—'],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface p-4">
            <dt className="text-[12px] text-muted">{k}</dt>
            <dd className="mt-0.5 text-[15px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      {energy.status === 'ok' && (
        <section className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">Referencia diaria</h2>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="num text-[40px] leading-none font-bold">{energy.target_range ? `${energy.target_range[0].toLocaleString('es-AR')}–${energy.target_range[1].toLocaleString('es-AR')}` : energy.target_kcal.toLocaleString('es-AR')}</span>
            <span className="text-muted">kcal</span>
          </p>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            {[
              ['Proteína', `${energy.protein_g} g`],
              ['Carbos', `${energy.carbs_g} g`],
              ['Grasas', `${energy.fat_g} g`],
              ['Agua', `${(energy.water_ml / 1000).toFixed(1).replace('.', ',')} L`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-raised px-1 py-2.5">
                <div className="num text-[15px] font-semibold">{v}</div>
                <div className="text-[11px] text-muted">{k}</div>
              </div>
            ))}
          </div>
          <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-muted">
            {energy.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      {age !== null && age < 18 && (
        <p className="rounded-2xl bg-warn/12 px-4 py-3 text-[14px] text-warn">Como sos menor de 18, el plan prioriza técnica y hábitos. Consultá con un profesional antes de cambios importantes.</p>
      )}
    </div>
  );
}
