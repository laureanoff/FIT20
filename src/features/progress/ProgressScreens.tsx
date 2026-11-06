import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ChevronRight, Columns2, Dumbbell, Footprints, ImagePlus, Lock, Plus, Ruler, Scale, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, SectionTitle, Spinner, cx } from '@/components/ui';
import { useData, useOnline, useProfile } from '@/app/data';
import { localToday } from '@/core/utils/date';
import { dateLabel } from '@/features/training/format';
import { BackLink } from '@/features/training/LibraryScreens';
import { useCtx } from '@/features/training/hooks';
import { type BodyMeasurement, type L, type Pose, type ProgressPhoto, alive } from '@/lib/db/database';
import { fetchPhotoFile } from '@/lib/sync/photos';
import { supabase } from '@/lib/supabase';
import { MEASURE_FIELDS, type MeasureKey, type MeasureValues, addPhoto, deleteMeasurement, deletePhoto, saveMeasurement, seriesOf, weeklyTrend } from './actions';
import { LineChart } from './LineChart';

const POSES: { value: Pose; label: string }[] = [
  { value: 'front', label: 'Frente' },
  { value: 'side', label: 'Perfil' },
  { value: 'back', label: 'Espalda' },
  { value: 'other', label: 'Otra' },
];
const fmt = (n: number, d = 1) => n.toLocaleString('es-AR', { maximumFractionDigits: d });

function useMeasurements() {
  const { db } = useData();
  return useLiveQuery(async () => (await db.body_measurements.toArray()).filter(alive).sort((a, b) => b.measured_on.localeCompare(a.measured_on) || b.updated_at.localeCompare(a.updated_at)), [db]);
}

function usePhotos() {
  const { db } = useData();
  return useLiveQuery(async () => (await db.progress_photos.toArray()).filter(alive).sort((a, b) => b.photo_date.localeCompare(a.photo_date) || b.updated_at.localeCompare(a.updated_at)), [db]);
}

/** URL local de una foto: del dispositivo o, si se subió desde otro, descargada (y guardada) del bucket privado. */
export function usePhotoUrl(photo: Pick<ProgressPhoto, 'id' | 'storage_path'> | null | undefined): { url: string | null; state: 'loading' | 'ok' | 'offline' } {
  const { db } = useData();
  const online = useOnline();
  const [res, setRes] = useState<{ url: string | null; state: 'loading' | 'ok' | 'offline' }>({ url: null, state: 'loading' });
  useEffect(() => {
    if (!photo) return;
    let url: string | null = null;
    let cancel = false;
    void (async () => {
      let blob = (await db.photo_blobs.get(photo.id))?.blob ?? null;
      if (!blob && online && supabase) blob = await fetchPhotoFile(db, supabase, photo.id, photo.storage_path);
      if (cancel) return;
      if (blob) {
        url = URL.createObjectURL(blob);
        setRes({ url, state: 'ok' });
      } else setRes({ url: null, state: 'offline' });
    })();
    return () => {
      cancel = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [db, photo?.id, photo?.storage_path, online, photo]);
  return res;
}

// ───────── Pantalla principal ─────────

export function ProgressScreen() {
  const profile = useProfile();
  const ms = useMeasurements();
  const photos = usePhotos();
  const activity = useActivity();
  const [metric, setMetric] = useState<MeasureKey>('weight_kg');

  if (!ms || !photos || !activity) return <Spinner />;
  const series = seriesOf(ms, metric);
  const field = MEASURE_FIELDS.find((f) => f.key === metric)!;
  const weights = seriesOf(ms, 'weight_kg');
  const first = weights[0];
  const last = weights[weights.length - 1];
  const trend = last ? weeklyTrend(weights, last.date) : null;
  const available = MEASURE_FIELDS.filter((f) => f.key === 'weight_kg' || ms.some((m) => m[f.key] !== null));

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold tracking-tight">Progreso</h1>
        <Link to="/progreso/medir" className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-ink">
          <Plus className="size-4" aria-hidden /> Registrar
        </Link>
      </div>

      {/* Peso */}
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold tracking-wide text-muted uppercase">Peso actual</p>
            <p className="num mt-1 text-[36px] leading-none font-bold">
              {fmt(last?.value ?? profile.current_weight_kg)}
              <span className="text-[16px] font-medium text-muted"> kg</span>
            </p>
          </div>
          <div className="text-right text-[13px]">
            {first && last && first.date !== last.date && (
              <p className={cx('inline-flex items-center gap-1 font-semibold', last.value <= first.value ? 'text-ok' : 'text-warn')}>
                {last.value <= first.value ? <TrendingDown className="size-4" aria-hidden /> : <TrendingUp className="size-4" aria-hidden />}
                {last.value - first.value > 0 ? '+' : ''}
                {fmt(last.value - first.value)} kg desde el inicio
              </p>
            )}
            {trend !== null && <p className="text-muted">Tendencia: {trend > 0 ? '+' : ''}{fmt(trend, 2)} kg/semana</p>}
            {profile.target_weight_kg && <p className="text-muted">Objetivo: {fmt(profile.target_weight_kg)} kg</p>}
          </div>
        </div>
        {trend !== null && Math.abs(trend) > 1 && (
          <p className="mt-3 rounded-xl bg-warn/12 px-3 py-2 text-[13px] text-warn">Un cambio de más de 1 kg por semana suele ser demasiado rápido. Si es sostenido, conviene revisarlo con un profesional.</p>
        )}
      </Card>

      {/* Gráfico */}
      <Card>
        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
          {available.map((f) => (
            <button key={f.key} type="button" aria-pressed={metric === f.key} onClick={() => setMetric(f.key)} className={cx('min-h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium', metric === f.key ? 'bg-ink text-bg' : 'bg-raised text-muted')}>
              {f.label}
            </button>
          ))}
        </div>
        {series.length ? (
          <LineChart points={series} unit={field.unit} label={field.label} target={metric === 'weight_kg' ? profile.target_weight_kg : null} />
        ) : (
          <p className="py-8 text-center text-[14px] text-muted">
            Todavía no hay registros de {field.label.toLowerCase()}.{' '}
            <Link to="/progreso/medir" className="text-ink underline underline-offset-4">
              Registrar
            </Link>
          </p>
        )}
        {series.length === 1 && <p className="mt-2 text-center text-[12px] text-faint">Con más registros vas a ver la evolución.</p>}
      </Card>

      {/* Fotos */}
      <Card>
        <SectionTitle
          action={
            photos.length >= 2 ? (
              <Link to="/progreso/comparar" className="-mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-raised px-3 text-[13px] font-medium">
                <Columns2 className="size-3.5" aria-hidden /> Antes y después
              </Link>
            ) : undefined
          }
        >
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden /> Fotos privadas
          </span>
        </SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          <Link to="/progreso/foto-nueva" className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line text-[12px] text-muted">
            <Camera className="size-6" aria-hidden /> Agregar
          </Link>
          {photos.slice(0, 8).map((p) => (
            <Link key={p.id} to={`/progreso/foto/${p.id}`} className="relative overflow-hidden rounded-2xl bg-raised">
              <Thumb photo={p} />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 px-2 pt-4 pb-1.5 text-[11px] font-medium text-white">{dateLabel(p.photo_date, { day: 'numeric', month: 'short' })}</span>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-faint">Solo vos podés verlas: se guardan en este dispositivo y en un espacio privado de tu cuenta.</p>
      </Card>

      {/* Actividad */}
      <Card>
        <SectionTitle>Actividad de los últimos 30 días</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<Dumbbell className="size-4" />} value={String(activity.workouts)} label="Sesiones de fuerza" />
          <Stat icon={<Footprints className="size-4" />} value={`${fmt(activity.km)} km`} label={`${activity.runs} ${activity.runs === 1 ? 'salida' : 'salidas'} de cardio`} />
          <Stat icon={<Ruler className="size-4" />} value={String(activity.days)} label="Días activos" />
        </div>
      </Card>

      {/* Historial */}
      {ms.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">Registros</h2>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {ms.slice(0, 30).map((m) => (
                <li key={m.id}>
                  <Link to={`/progreso/medir?id=${m.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                    <Scale className="size-4 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px]">{dateLabel(m.measured_on, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {MEASURE_FIELDS.filter((f) => m[f.key] !== null)
                          .map((f) => `${f.label} ${fmt(m[f.key] as number)} ${f.unit}`)
                          .join(' · ')}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-raised p-3">
      <span className="text-muted">{icon}</span>
      <div className="num mt-1 text-[18px] font-semibold">{value}</div>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
    </div>
  );
}

function useActivity() {
  const { db } = useData();
  return useLiveQuery(async () => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const sinceIso = since.toISOString();
    const sinceDate = sinceIso.slice(0, 10);
    const ws = (await db.workouts.toArray()).filter((w) => alive(w) && w.status === 'completed' && w.started_at >= sinceIso);
    const rs = (await db.running_sessions.toArray()).filter((r) => alive(r) && r.session_date >= sinceDate);
    const days = new Set([...ws.map((w) => w.started_at.slice(0, 10)), ...rs.map((r) => r.session_date)]);
    return { workouts: ws.length, runs: rs.length, km: rs.reduce((a, r) => a + r.distance_km, 0), days: days.size };
  }, [db]);
}

function Thumb({ photo, className }: { photo: ProgressPhoto; className?: string }) {
  const { url, state } = usePhotoUrl(photo);
  if (url) return <img src={url} alt={`Foto de progreso del ${dateLabel(photo.photo_date)}`} className={cx('aspect-[3/4] w-full object-cover', className)} />;
  return <div className={cx('grid aspect-[3/4] w-full place-items-center p-2 text-center text-[11px] text-faint', className)}>{state === 'loading' ? '…' : 'Se ve con conexión'}</div>;
}

// ───────── Registrar peso y medidas ─────────

export function MeasureScreen() {
  const [params] = useSearchParams();
  const editId = params.get('id');
  const { db } = useData();
  const ctx = useCtx();
  const navigate = useNavigate();
  const existing = useLiveQuery(async () => (editId ? ((await db.body_measurements.get(editId)) ?? null) : null), [db, editId]);
  if (editId && existing === undefined) return <Spinner />;
  return <MeasureForm key={existing?.id ?? 'new'} existing={existing ?? null} onDone={() => navigate('/progreso', { replace: true })} onDelete={existing ? () => deleteMeasurement(ctx, existing).then(() => navigate('/progreso', { replace: true })) : undefined} />;
}

function MeasureForm({ existing, onDone, onDelete }: { existing: L<BodyMeasurement> | null; onDone: () => void; onDelete?: () => Promise<void> }) {
  const ctx = useCtx();
  const today = localToday();
  const [date, setDate] = useState(existing?.measured_on ?? today);
  const [vals, setVals] = useState<Record<MeasureKey, string>>(() => Object.fromEntries(MEASURE_FIELDS.map((f) => [f.key, existing?.[f.key] != null ? String(existing[f.key]).replace('.', ',') : ''])) as Record<MeasureKey, string>);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [showMore, setShowMore] = useState(!!existing && MEASURE_FIELDS.some((f) => f.key !== 'weight_kg' && existing[f.key] !== null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function save() {
    const values = Object.fromEntries(MEASURE_FIELDS.map((f) => [f.key, vals[f.key].trim() ? Number(vals[f.key].replace(',', '.')) : null])) as MeasureValues;
    setBusy(true);
    setError(null);
    try {
      await saveMeasurement(ctx, { id: existing?.id, date, values, notes }, today);
      onDone();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/progreso" label="Progreso" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">{existing ? 'Editar registro' : 'Peso y medidas'}</h1>
        <p className="text-[14px] text-muted">Para comparar bien: pesate en ayunas, después de ir al baño, siempre en el mismo momento del día.</p>
      </div>
      <Field label="Fecha" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      <Field label="Peso" inputMode="decimal" suffix="kg" autoFocus={!existing} value={vals.weight_kg} onChange={(e) => setVals({ ...vals, weight_kg: e.target.value.replace(/[^\d,.]/g, '') })} />
      {showMore ? (
        <div className="grid grid-cols-2 gap-3">
          {MEASURE_FIELDS.filter((f) => f.key !== 'weight_kg').map((f) => (
            <Field key={f.key} label={f.label} inputMode="decimal" suffix={f.unit} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value.replace(/[^\d,.]/g, '') })} />
          ))}
          <p className="col-span-2 text-[12px] text-faint">Cintura: a la altura del ombligo. Cadera: en la parte más ancha. Brazo y muslo: en el punto más grueso, relajado.</p>
        </div>
      ) : (
        <button type="button" onClick={() => setShowMore(true)} className="inline-flex min-h-11 items-center gap-2 self-start text-[14px] text-muted">
          <Ruler className="size-4" aria-hidden /> Agregar medidas (cintura, cadera…)
        </button>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-muted">Notas (opcional)</span>
        <textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} rows={2} className="rounded-xl border border-line bg-surface p-3 text-[16px] outline-none focus:border-accent" />
      </label>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button onClick={save} loading={busy}>
        Guardar
      </Button>
      {onDelete &&
        (confirm ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void onDelete()}>
              <Trash2 className="size-4" aria-hidden /> Borrar
            </Button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="self-center py-2 text-[14px] text-danger">
            Borrar registro
          </button>
        ))}
    </div>
  );
}

// ───────── Fotos ─────────

export function NewPhotoScreen() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pose, setPose] = useState<Pose>('front');
  const [date, setDate] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/progreso" label="Progreso" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">Nueva foto</h1>
        <p className="text-[14px] text-muted">Mismo lugar, misma luz y misma pose cada vez: así la comparación es real.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Elegir foto"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (!f.type.startsWith('image/')) return setError('El archivo tiene que ser una imagen.');
          if (f.size > 25_000_000) return setError('La imagen es demasiado grande (máx. 25 MB).');
          setError(null);
          setFile(f);
        }}
      />
      <button type="button" onClick={() => input.current?.click()} className="relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-3xl border-2 border-dashed border-line bg-surface">
        {preview ? (
          <img src={preview} alt="Vista previa" className="absolute inset-0 size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-2 text-muted">
            <ImagePlus className="size-8" aria-hidden />
            Sacar o elegir foto
          </span>
        )}
      </button>
      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-raised p-1" role="radiogroup" aria-label="Pose">
        {POSES.map((p) => (
          <button key={p.value} type="button" role="radio" aria-checked={pose === p.value} onClick={() => setPose(p.value)} className={cx('min-h-10 rounded-xl text-[14px] font-medium', pose === p.value ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
            {p.label}
          </button>
        ))}
      </div>
      <Field label="Fecha" type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} />
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button
        disabled={!file}
        loading={busy}
        onClick={async () => {
          if (!file) return;
          setBusy(true);
          try {
            await addPhoto(ctx, file, { date, pose, notes: '' });
            navigate('/progreso', { replace: true });
          } catch (e) {
            setBusy(false);
            setError(e instanceof Error ? e.message : 'No se pudo guardar la foto.');
          }
        }}
      >
        Guardar foto
      </Button>
    </div>
  );
}

export function PhotoScreen() {
  const { id } = useParams();
  const { db } = useData();
  const ctx = useCtx();
  const navigate = useNavigate();
  const photo = useLiveQuery(async () => (id ? ((await db.progress_photos.get(id)) ?? null) : null), [db, id]);
  const upload = useLiveQuery(async () => (id ? ((await db.photo_blobs.get(id)) ?? null) : null), [db, id]);
  const [confirm, setConfirm] = useState(false);
  if (photo === undefined) return <Spinner />;
  if (!photo || photo.deleted_at) return <p className="pt-6 text-muted">Foto no encontrada.</p>;
  return (
    <div className="flex flex-col gap-4 pt-2">
      <BackLink to="/progreso" label="Progreso" />
      <div className="overflow-hidden rounded-3xl bg-raised">
        <Thumb photo={photo} className="aspect-auto max-h-[70vh] object-contain" />
      </div>
      <p className="text-[15px]">
        {dateLabel(photo.photo_date)} · {POSES.find((p) => p.value === photo.pose)?.label ?? 'Sin pose'}
      </p>
      {upload?.state === 'pending' && <p className="text-[13px] text-warn">Pendiente de subir a tu espacio privado (se sube sola con conexión).</p>}
      {confirm ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await deletePhoto(ctx, photo);
              navigate('/progreso', { replace: true });
            }}
          >
            <Trash2 className="size-4" aria-hidden /> Borrar
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="self-center py-2 text-[14px] text-danger">
          Borrar foto
        </button>
      )}
    </div>
  );
}

// ───────── Antes y después ─────────

export function CompareScreen() {
  const photos = usePhotos();
  const ms = useMeasurements();
  const [pose, setPose] = useState<Pose | 'all'>('all');
  const list = useMemo(() => (photos ?? []).filter((p) => pose === 'all' || p.pose === pose).sort((a, b) => a.photo_date.localeCompare(b.photo_date)), [photos, pose]);
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [split, setSplit] = useState(50);
  if (!photos || !ms) return <Spinner />;

  const before = list.find((p) => p.id === beforeId) ?? list[0];
  const after = list.find((p) => p.id === afterId) ?? list[list.length - 1];
  const weightOn = (date: string) => {
    const w = seriesOf(ms, 'weight_kg').filter((p) => p.date <= date);
    return w[w.length - 1]?.value ?? null;
  };
  const wb = before ? weightOn(before.photo_date) : null;
  const wa = after ? weightOn(after.photo_date) : null;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/progreso" label="Progreso" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">Antes y después</h1>
      </div>
      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {([{ value: 'all', label: 'Todas' }, ...POSES] as { value: Pose | 'all'; label: string }[]).map((p) => (
          <button key={p.value} type="button" aria-pressed={pose === p.value} onClick={() => { setPose(p.value); setBeforeId(null); setAfterId(null); }} className={cx('min-h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium', pose === p.value ? 'bg-ink text-bg' : 'bg-raised text-muted')}>
            {p.label}
          </button>
        ))}
      </div>
      {list.length < 2 || !before || !after ? (
        <p className="rounded-3xl border border-dashed border-line p-6 text-center text-[14px] text-muted">Necesitás al menos dos fotos{pose !== 'all' ? ' con esa pose' : ''} para comparar.</p>
      ) : (
        <>
          <CompareSlider before={before} after={after} split={split} />
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Deslizar entre antes y después" className="w-full accent-[var(--c-accent)]" />
          <div className="grid grid-cols-2 gap-3 text-[14px]">
            <PhotoPick label="Antes" list={list} value={before.id} onChange={setBeforeId} weight={wb} />
            <PhotoPick label="Después" list={list} value={after.id} onChange={setAfterId} weight={wa} />
          </div>
          {wb !== null && wa !== null && (
            <p className="rounded-2xl bg-raised px-4 py-3 text-[14px]">
              Diferencia de peso entre las dos fechas: <strong className="num">{wa - wb > 0 ? '+' : ''}{fmt(wa - wb)} kg</strong>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CompareSlider({ before, after, split }: { before: ProgressPhoto; after: ProgressPhoto; split: number }) {
  const b = usePhotoUrl(before);
  const a = usePhotoUrl(after);
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-3xl bg-raised">
      {a.url && <img src={a.url} alt="Después" className="absolute inset-0 size-full object-cover" />}
      {b.url && <img src={b.url} alt="Antes" className="absolute inset-0 size-full object-cover" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />}
      <div className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${split}%` }} aria-hidden />
      <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[12px] text-white">Antes</span>
      <span className="absolute top-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[12px] text-white">Después</span>
      {(!a.url || !b.url) && <p className="absolute inset-x-0 bottom-3 text-center text-[12px] text-muted">{a.state === 'offline' || b.state === 'offline' ? 'Alguna foto se ve solo con conexión.' : 'Cargando…'}</p>}
    </div>
  );
}

function PhotoPick({ label, list, value, onChange, weight }: { label: string; list: ProgressPhoto[]; value: string; onChange: (id: string) => void; weight: number | null }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-[15px]">
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {dateLabel(p.photo_date, { day: 'numeric', month: 'short', year: 'numeric' })}
          </option>
        ))}
      </select>
      {weight !== null && <span className="num text-[12px] text-muted">{fmt(weight)} kg</span>}
    </label>
  );
}
