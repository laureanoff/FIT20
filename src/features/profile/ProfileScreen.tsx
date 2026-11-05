import Dexie from 'dexie';
import { ArrowLeft, ChevronRight, Download, LogOut, Trash2 } from 'lucide-react';
import { type ComponentType, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, SectionTitle, Segmented, Toggle } from '@/components/ui';
import { syncLabel } from '@/components/SyncBadge';
import { useData, useOnline, useProfile, useSyncStatus } from '@/app/data';
import { GOAL_LABELS, INJURY_LABELS, LEVEL_LABELS, RUN_LABELS, WEEKDAYS } from '@/app/labels';
import { EQUIPMENT_LABELS } from '@/data/exercises';
import { type Fit20DB, LOCAL_ENTITIES, closeUserDB, tableFor } from '@/lib/db/database';
import { supabase } from '@/lib/supabase';
import { initials } from '@/app/AppLayout';
import { ConflictsList } from './Conflicts';
import { type DraftErrors, type ProfileDraft, STEP_FIELDS, draftFromProfile, profileFields, stepErrors } from './form';
import { AboutSection, EquipmentSection, ExperienceSection, FoodSection, GoalSection, ScheduleSection, type SectionProps } from './sections';

type SectionKey = keyof typeof STEP_FIELDS;

const EDIT_SECTIONS: Record<SectionKey, { title: string; Body: ComponentType<SectionProps> }> = {
  about: { title: 'Datos personales', Body: AboutSection },
  goal: { title: 'Objetivo', Body: GoalSection },
  experience: { title: 'Experiencia', Body: ExperienceSection },
  schedule: { title: 'Disponibilidad', Body: ScheduleSection },
  equipment: { title: 'Equipamiento y lesiones', Body: EquipmentSection },
  food: { title: 'Alimentación', Body: FoodSection },
};

const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'Ninguna');

export function ProfileScreen() {
  const profile = useProfile();
  const { email } = useData();
  const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });

  const rows: { key: SectionKey; value: string }[] = [
    { key: 'about', value: `${num(profile.height_cm)} cm · ${num(profile.current_weight_kg)} kg` },
    { key: 'goal', value: GOAL_LABELS[profile.primary_goal].title },
    { key: 'experience', value: `${LEVEL_LABELS[profile.fitness_level].title} · ${RUN_LABELS[profile.running_experience].title}` },
    { key: 'schedule', value: `${WEEKDAYS.filter((d) => profile.training_weekdays.includes(d.value)).map((d) => d.short).join(' ')} · ${profile.session_minutes} min` },
    { key: 'equipment', value: `${profile.equipment.map((e) => EQUIPMENT_LABELS[e]).join(', ')}${profile.injuries.length ? ` · Cuidar: ${profile.injuries.map((i) => INJURY_LABELS[i]).join(', ')}` : ''}` },
    { key: 'food', value: list([...profile.dietary_preferences, ...profile.dietary_restrictions]) },
  ];

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex items-center gap-4">
        <span className="grid size-16 place-items-center rounded-full bg-accent text-[22px] font-bold text-accent-ink">{initials(profile.full_name)}</span>
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-bold tracking-tight">{profile.full_name}</h1>
          <p className="truncate text-[14px] text-muted">{email}</p>
        </div>
      </div>

      <Card className="p-0">
        <h2 className="sr-only">Perfil</h2>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key}>
              <Link to={`/perfil/${r.key}`} className="flex min-h-16 items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{EDIT_SECTIONS[r.key].title}</span>
                  <span className="block truncate text-[13px] text-muted">{r.value}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <SettingsCard />
      <SyncCard />
      <AccountCard />
    </div>
  );
}

function SettingsCard() {
  const { settings, saveSettings } = useData();
  return (
    <Card>
      <SectionTitle>Ajustes</SectionTitle>
      <div className="flex flex-col gap-3">
        <Segmented
          label="Tema"
          value={settings.theme}
          onChange={(theme) => void saveSettings({ theme })}
          options={[
            { value: 'dark', label: 'Oscuro' },
            { value: 'light', label: 'Claro' },
            { value: 'system', label: 'Sistema' },
          ]}
        />
        <Toggle label="Sonido" description="Avisos del temporizador" checked={settings.sound_enabled} onChange={(v) => void saveSettings({ sound_enabled: v })} />
        <Toggle label="Vibración" checked={settings.vibration_enabled} onChange={(v) => void saveSettings({ vibration_enabled: v })} />
        <div className="flex flex-col gap-2">
          <span className="text-[15px]">Descanso por defecto entre series</span>
          <Segmented
            label="Descanso por defecto"
            value={String(settings.default_rest_seconds)}
            onChange={(v) => void saveSettings({ default_rest_seconds: Number(v) })}
            options={['45', '60', '90', '120'].map((s) => ({ value: s, label: `${s} s` }))}
          />
        </div>
      </div>
    </Card>
  );
}

function SyncCard() {
  const { state, pending, errors, lastSyncAt, lastError, retry } = useSyncStatus();
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <SectionTitle>Sincronización</SectionTitle>
      <p className="text-[15px] font-medium">{syncLabel(state, pending)}</p>
      <p className="mt-1 text-[13px] text-muted">
        {lastSyncAt ? `Última sincronización: ${new Date(lastSyncAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Todo lo que registrás se guarda primero en este dispositivo y se sube a la nube cuando hay conexión.'}
      </p>
      {errors > 0 && lastError && <p className="mt-2 text-[13px] break-words text-danger">{lastError}</p>}
      <ConflictsList />
      {(errors > 0 || pending > 0) && state !== 'offline' && (
        <Button
          variant="secondary"
          className="mt-4 w-full"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await retry();
            setBusy(false);
          }}
        >
          Reintentar ahora
        </Button>
      )}
    </Card>
  );
}

function AccountCard() {
  const { pending } = useSyncStatus();
  const { db } = useData();
  const online = useOnline();
  const [confirmingOut, setConfirmingOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (pending > 0 && !confirmingOut) return setConfirmingOut(true);
    // scope local: funciona aun sin conexión. Los datos locales quedan para el próximo inicio de sesión.
    await supabase?.auth.signOut({ scope: 'local' });
  }

  async function deleteAccount() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke('delete-account', { body: { confirm: 'ELIMINAR' } });
    if (err) {
      setBusy(false);
      return setError('No se pudo eliminar la cuenta. Verificá tu conexión y probá de nuevo.');
    }
    const name = db.name;
    await supabase.auth.signOut({ scope: 'local' });
    closeUserDB();
    await Dexie.delete(name);
  }

  return (
    <Card>
      <SectionTitle>Cuenta</SectionTitle>
      {confirmingOut && (
        <p className="mb-3 rounded-xl bg-warn/12 px-4 py-3 text-[14px] text-warn">
          Tenés {pending} {pending === 1 ? 'cambio' : 'cambios'} sin subir. Quedan guardados en este dispositivo y se suben cuando vuelvas a iniciar sesión acá. Tocá de nuevo para salir.
        </p>
      )}
      <Button variant="secondary" className="mb-2 w-full" onClick={() => void exportData(db)}>
        <Download className="size-4" aria-hidden /> Descargar mis datos
      </Button>
      <Button variant="secondary" className="w-full" onClick={signOut}>
        <LogOut className="size-4" aria-hidden /> Cerrar sesión
      </Button>

      {!deleting ? (
        <button type="button" onClick={() => setDeleting(true)} className="mt-4 w-full py-2 text-[14px] text-danger">
          Eliminar mi cuenta
        </button>
      ) : (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-danger/40 p-4">
          <p className="text-[14px]">Se borran tu cuenta y todos tus datos (entrenamientos, comidas, fotos) de forma permanente. No se puede deshacer.</p>
          <Field label='Escribí "ELIMINAR" para confirmar' value={confirmText} autoCapitalize="characters" onChange={(e) => setConfirmText(e.target.value)} />
          {!online && <p className="text-[13px] text-warn">Necesitás conexión para eliminar la cuenta.</p>}
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={confirmText.trim() !== 'ELIMINAR' || !online} loading={busy} onClick={deleteAccount}>
              <Trash2 className="size-4" aria-hidden /> Eliminar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function ProfileEditScreen() {
  const { section } = useParams();
  const key = section as SectionKey;
  const def = EDIT_SECTIONS[key];
  const profile = useProfile();
  const { saveProfile } = useData();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);

  if (!def) return <p className="pt-6 text-muted">Sección no encontrada.</p>;

  async function save() {
    const errs = stepErrors(draft, key);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    await saveProfile({ id: profile.id, ...profileFields(draft), onboarding_completed: true });
    navigate('/perfil');
  }

  const { Body } = def;
  return (
    <div className="pt-2">
      <Link to="/perfil" className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[14px] text-muted">
        <ArrowLeft className="size-4" aria-hidden /> Perfil
      </Link>
      <h1 className="mt-1 mb-6 text-[26px] font-bold tracking-tight">{def.title}</h1>
      <Body
        draft={draft}
        set={(patch) => {
          setDraft((d) => ({ ...d, ...patch }));
          setErrors({});
        }}
        errors={errors}
      />
      <Button className="mt-8 w-full" onClick={save} loading={busy}>
        Guardar cambios
      </Button>
    </div>
  );
}

/** Copia de todos tus datos en un archivo JSON (las fotos quedan fuera: se descargan desde Progreso). */
export async function exportData(db: Fit20DB): Promise<void> {
  const out: Record<string, unknown[]> = {};
  for (const e of LOCAL_ENTITIES) {
    const rows = (await tableFor(db, e).toArray()) as Record<string, unknown>[];
    out[e] = rows
      .filter((r) => !r.deleted_at && !(e === 'food_items' && !r.owner_id))
      .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))));
  }
  const blob = new Blob([JSON.stringify({ app: 'FIT20', exported_at: new Date().toISOString(), data: out }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fit20-datos-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
