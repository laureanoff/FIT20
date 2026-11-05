import { type BodyMeasurement, type Fit20DB, type L, type Pose, type ProgressPhoto, alive } from '@/lib/db/database';
import { type PendingWrite, saveRecords } from '@/lib/db/repository';
import { newId } from '@/lib/id';
import type { Ctx } from '@/features/training/actions';

async function write(ctx: Ctx, writes: PendingWrite[]): Promise<void> {
  if ((await saveRecords(ctx.db, writes)) > 0) ctx.changed();
}

export const MEASURE_FIELDS = [
  { key: 'weight_kg', label: 'Peso', unit: 'kg', min: 25, max: 350 },
  { key: 'waist_cm', label: 'Cintura', unit: 'cm', min: 30, max: 250 },
  { key: 'hip_cm', label: 'Cadera', unit: 'cm', min: 30, max: 250 },
  { key: 'chest_cm', label: 'Pecho', unit: 'cm', min: 30, max: 250 },
  { key: 'arm_cm', label: 'Brazo', unit: 'cm', min: 10, max: 100 },
  { key: 'thigh_cm', label: 'Muslo', unit: 'cm', min: 20, max: 150 },
] as const;

export type MeasureKey = (typeof MEASURE_FIELDS)[number]['key'];
export type MeasureValues = Record<MeasureKey, number | null>;

/** Mismas reglas que los CHECK de `body_measurements`. */
export function validateMeasurement(date: string, values: MeasureValues, today: string): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) errors.push('Revisá la fecha (no puede ser futura).');
  let any = false;
  for (const f of MEASURE_FIELDS) {
    const v = values[f.key];
    if (v === null) continue;
    any = true;
    if (!Number.isFinite(v) || v < f.min || v > f.max) errors.push(`${f.label}: entre ${f.min} y ${f.max} ${f.unit}.`);
  }
  if (!any) errors.push('Cargá al menos un dato.');
  return errors;
}

/**
 * Guarda una medición. Si es el peso más reciente, actualiza también el peso del perfil
 * (así la referencia de calorías y agua sigue al día).
 */
export async function saveMeasurement(ctx: Ctx, input: { id?: string; date: string; values: MeasureValues; notes: string }, today: string): Promise<string> {
  const errors = validateMeasurement(input.date, input.values, today);
  if (errors.length) throw new Error(errors.join(' '));
  const id = input.id ?? newId();
  const prev = input.id ? await ctx.db.body_measurements.get(input.id) : undefined;
  const rec: Omit<BodyMeasurement, 'version' | 'updated_at'> = {
    ...(prev ?? {}),
    id,
    user_id: ctx.userId,
    measured_on: input.date,
    ...roundValues(input.values),
    notes: input.notes.trim() ? input.notes.trim().slice(0, 2000) : null,
    deleted_at: null,
  };
  const writes: PendingWrite[] = [{ entity: 'body_measurements', record: rec }];

  if (input.values.weight_kg !== null) {
    const latest = await latestWeight(ctx.db);
    if (!latest || input.date >= latest.measured_on || latest.id === id) {
      const profile = await ctx.db.profiles.get(ctx.userId);
      if (profile && profile.current_weight_kg !== rec.weight_kg) writes.push({ entity: 'profiles', record: { ...profile, current_weight_kg: rec.weight_kg } });
    }
  }
  await write(ctx, writes);
  return id;
}

function roundValues(v: MeasureValues): MeasureValues {
  const out = {} as MeasureValues;
  for (const f of MEASURE_FIELDS) {
    const x = v[f.key];
    out[f.key] = x === null ? null : Math.round(x * (f.key === 'weight_kg' ? 100 : 10)) / (f.key === 'weight_kg' ? 100 : 10);
  }
  return out;
}

export async function latestWeight(db: Fit20DB): Promise<L<BodyMeasurement> | null> {
  const all = (await db.body_measurements.toArray()).filter((m) => alive(m) && m.weight_kg !== null);
  all.sort((a, b) => b.measured_on.localeCompare(a.measured_on) || b.updated_at.localeCompare(a.updated_at));
  return all[0] ?? null;
}

export async function deleteMeasurement(ctx: Ctx, m: L<BodyMeasurement>): Promise<void> {
  await write(ctx, [{ entity: 'body_measurements', record: { ...m, deleted_at: new Date().toISOString() } }]);
}

// ───────── Fotos ─────────

const MAX_SIDE = 1600;

/** Reduce y convierte a JPEG (las fotos del celular pesan 3–8 MB; quedan en ~300 KB). */
export async function compressImage(file: Blob, maxSide = MAX_SIDE, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('No se pudo procesar la imagen.');
  return blob;
}

/** Guarda la foto en el dispositivo y la deja en cola para subir al bucket privado. */
export async function addPhoto(ctx: Ctx, file: Blob, meta: { date: string; pose: Pose | null; notes: string }): Promise<string> {
  const blob = file.type === 'image/jpeg' && file.size < 600_000 ? file : await compressImage(file);
  const id = newId();
  // La ruta empieza con el id del usuario: así lo exigen la base y las políticas del bucket.
  const storage_path = `${ctx.userId}/${id}.jpg`;
  await ctx.db.photo_blobs.put({ id, storage_path, blob, state: 'pending', error: null });
  const rec: Omit<ProgressPhoto, 'version' | 'updated_at'> = {
    id,
    user_id: ctx.userId,
    storage_path,
    photo_date: meta.date,
    pose: meta.pose,
    notes: meta.notes.trim() ? meta.notes.trim().slice(0, 1000) : null,
    deleted_at: null,
  };
  await write(ctx, [{ entity: 'progress_photos', record: rec }]);
  return id;
}

/** Borra la foto en todos los dispositivos y su archivo en la nube. */
export async function deletePhoto(ctx: Ctx, p: L<ProgressPhoto>): Promise<void> {
  await write(ctx, [{ entity: 'progress_photos', record: { ...p, deleted_at: new Date().toISOString() } }]);
  const local = await ctx.db.photo_blobs.get(p.id);
  if (local?.state === 'pending') await ctx.db.photo_blobs.delete(p.id); // nunca llegó a subirse
  else await ctx.db.photo_blobs.put({ id: p.id, storage_path: p.storage_path, blob: null, state: 'delete', error: null });
  ctx.changed();
}

// ───────── Estadísticas ─────────

export interface Point {
  date: string;
  value: number;
}

/** Serie de un dato (el último registro de cada día), ordenada por fecha. */
export function seriesOf(ms: readonly BodyMeasurement[], key: MeasureKey): Point[] {
  const byDay = new Map<string, BodyMeasurement>();
  for (const m of ms) {
    if (m[key] === null || m.deleted_at) continue;
    const cur = byDay.get(m.measured_on);
    if (!cur || m.updated_at > cur.updated_at) byDay.set(m.measured_on, m);
  }
  return [...byDay.values()].sort((a, b) => a.measured_on.localeCompare(b.measured_on)).map((m) => ({ date: m.measured_on, value: m[key] as number }));
}

/**
 * Tendencia semanal (kg/semana) por mínimos cuadrados sobre los últimos `days` días.
 * null si hay pocos datos: con 2 pesajes el "ritmo" es puro ruido de agua.
 */
export function weeklyTrend(points: readonly Point[], lastDate: string, days = 28): number | null {
  const from = new Date(`${lastDate}T00:00:00Z`).getTime() - days * 86_400_000;
  const pts = points.map((p) => ({ x: new Date(`${p.date}T00:00:00Z`).getTime(), y: p.value })).filter((p) => p.x >= from);
  if (pts.length < 3) return null;
  const span = (pts[pts.length - 1]!.x - pts[0]!.x) / 86_400_000;
  if (span < 7) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const num = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const den = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return den ? Math.round((num / den) * 7 * 86_400_000 * 100) / 100 : null;
}
