import type { SupabaseClient } from '@supabase/supabase-js';
import type { Fit20DB } from '@/lib/db/database';

export const PHOTO_BUCKET = 'progress-photos';

/**
 * Sube las fotos pendientes y borra de la nube las eliminadas. Las fotos viajan aparte de la
 * cola de registros: un archivo de varios MB no debe frenar la sincronización del resto.
 * Devuelve cuántas quedaron sin procesar (para el indicador).
 */
export async function syncPhotoFiles(db: Fit20DB, client: SupabaseClient): Promise<number> {
  const bucket = client.storage.from(PHOTO_BUCKET);
  let left = 0;

  for (const p of await db.photo_blobs.where('state').equals('pending').toArray()) {
    if (!p.blob) continue;
    const { error } = await bucket.upload(p.storage_path, p.blob, { contentType: p.blob.type || 'image/jpeg', upsert: true });
    if (error) {
      left++;
      await db.photo_blobs.update(p.id, { error: error.message });
      if (/fetch|network/i.test(error.message)) break; // sin conexión: reintentar en el próximo ciclo
    } else {
      await db.photo_blobs.update(p.id, { state: 'synced', error: null });
    }
  }

  for (const p of await db.photo_blobs.where('state').equals('delete').toArray()) {
    const { error } = await bucket.remove([p.storage_path]);
    if (error) {
      left++;
      await db.photo_blobs.update(p.id, { error: error.message });
    } else {
      await db.photo_blobs.delete(p.id);
    }
  }
  return left;
}

/** Descarga (y guarda para ver sin conexión) una foto subida desde otro dispositivo. */
export async function fetchPhotoFile(db: Fit20DB, client: SupabaseClient, id: string, storage_path: string): Promise<Blob | null> {
  const { data, error } = await client.storage.from(PHOTO_BUCKET).download(storage_path);
  if (error || !data) return null;
  await db.photo_blobs.put({ id, storage_path, blob: data, state: 'synced', error: null });
  return data;
}
