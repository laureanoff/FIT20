import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Fit20DB, alive } from '@/lib/db/database';
import type { Ctx } from '@/features/training/actions';
import { addPhoto, deleteMeasurement, deletePhoto, saveMeasurement, seriesOf, validateMeasurement, weeklyTrend } from '@/features/progress/actions';
import { syncPhotoFiles } from '@/lib/sync/photos';
import type { SupabaseClient } from '@supabase/supabase-js';

const UID = '77777777-7777-4777-8777-777777777777';
const empty = { weight_kg: null, waist_cm: null, hip_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null };
let db: Fit20DB;
let ctx: Ctx;
beforeEach(async () => {
  db = new Fit20DB(`${UID}-${Math.random()}`);
  await db.open();
  ctx = { db, userId: UID, changed: () => {} };
  await db.profiles.put({
    id: UID, full_name: 'Lau', birth_date: '1995-03-10', sex: 'male', height_cm: 178, current_weight_kg: 82, target_weight_kg: 77, fitness_level: 'beginner',
    running_experience: 'none', max_run_distance_km: 0, training_weekdays: [1], session_minutes: 45, equipment: ['bodyweight'], dietary_preferences: [],
    dietary_restrictions: [], injuries: [], primary_goal: 'lose_fat', onboarding_completed: true, version: 1, updated_at: '', deleted_at: null, _server_version: 1,
  });
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('peso y medidas', () => {
  it('valida con las reglas de la base', () => {
    expect(validateMeasurement('2026-11-05', empty, '2026-11-05')).toEqual(['Cargá al menos un dato.']);
    expect(validateMeasurement('2026-11-06', { ...empty, weight_kg: 80 }, '2026-11-05')[0]).toMatch(/fecha/);
    expect(validateMeasurement('2026-11-05', { ...empty, waist_cm: 10 }, '2026-11-05')[0]).toMatch(/Cintura/);
  });

  it('el pesaje más reciente actualiza el peso del perfil; uno viejo no', async () => {
    await saveMeasurement(ctx, { date: '2026-11-05', values: { ...empty, weight_kg: 81.36 }, notes: '' }, '2026-11-05');
    expect((await db.profiles.get(UID))!.current_weight_kg).toBe(81.36);
    await saveMeasurement(ctx, { date: '2026-10-01', values: { ...empty, weight_kg: 84 }, notes: '' }, '2026-11-05');
    expect((await db.profiles.get(UID))!.current_weight_kg).toBe(81.36);
    const all = await db.body_measurements.toArray();
    expect(seriesOf(all, 'weight_kg').map((p) => p.value)).toEqual([84, 81.36]);
    await deleteMeasurement(ctx, all[0]!);
    expect((await db.body_measurements.toArray()).filter(alive)).toHaveLength(1);
  });

  it('tendencia semanal solo con datos suficientes', () => {
    const pts = [0, 7, 14, 21].map((d, i) => ({ date: `2026-10-${String(1 + d).padStart(2, '0')}`, value: 84 - i * 0.5 }));
    expect(weeklyTrend(pts, '2026-10-22')).toBe(-0.5);
    expect(weeklyTrend(pts.slice(0, 2), '2026-10-08')).toBeNull();
  });
});

describe('fotos privadas', () => {
  it('guarda la foto local, la sube a la carpeta del usuario y la borra de la nube', async () => {
    const calls: string[] = [];
    const client = {
      storage: {
        from: () => ({
          upload: async (path: string) => (calls.push(`up:${path}`), { error: null }),
          remove: async (paths: string[]) => (calls.push(`rm:${paths[0]}`), { error: null }),
        }),
      },
    } as unknown as SupabaseClient;

    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    const id = await addPhoto(ctx, blob, { date: '2026-11-05', pose: 'front', notes: '' });
    const rec = (await db.progress_photos.get(id))!;
    expect(rec.storage_path).toBe(`${UID}/${id}.jpg`);
    expect((await db.photo_blobs.get(id))!.state).toBe('pending');

    expect(await syncPhotoFiles(db, client)).toBe(0);
    expect((await db.photo_blobs.get(id))!.state).toBe('synced');

    await deletePhoto(ctx, rec);
    expect((await db.photo_blobs.get(id))!.state).toBe('delete');
    await syncPhotoFiles(db, client);
    expect(await db.photo_blobs.get(id)).toBeUndefined();
    expect(calls).toEqual([`up:${UID}/${id}.jpg`, `rm:${UID}/${id}.jpg`]);
  });
});
