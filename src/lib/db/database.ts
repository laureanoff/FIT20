import Dexie, { type Table } from 'dexie';
import type { Profile } from '@/types/domain';
import type { ConflictEvent, SyncOperation } from '@/core/sync/types';

/**
 * Metadatos solo-dispositivo. Los campos que empiezan con "_" nunca se envían al servidor
 * (ver `sanitize` en lib/sync/supabase-remote.ts).
 */
export interface LocalMeta {
  /** Versión que el servidor confirmó por última vez; null = el servidor todavía no conoce el registro. */
  _server_version: number | null;
}

export type ThemePreference = 'dark' | 'light' | 'system';

export interface UserSettings {
  id: string;
  user_id: string;
  theme: ThemePreference;
  units: 'metric' | 'imperial';
  notifications_enabled: boolean;
  sound_enabled: boolean;
  vibration_enabled: boolean;
  default_rest_seconds: number;
  reminders: unknown[];
  offline_enabled: boolean;
  nutrition_targets: Record<string, number> | null;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

export type LocalProfile = Profile & LocalMeta;
export type LocalSettings = UserSettings & LocalMeta;

export interface StoredConflict extends ConflictEvent {
  seq?: number;
  seen: boolean;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/**
 * Una base IndexedDB por usuario: en un dispositivo compartido nadie ve datos ni
 * operaciones pendientes de otra cuenta, y cerrar sesión no mezcla colas.
 */
export class Fit20DB extends Dexie {
  profiles!: Table<LocalProfile, string>;
  user_settings!: Table<LocalSettings, string>;
  outbox!: Table<SyncOperation, string>;
  conflicts!: Table<StoredConflict, number>;
  meta!: Table<MetaEntry, string>;

  constructor(userId: string) {
    super(`fit20-${userId}`);
    this.version(1).stores({
      profiles: 'id',
      user_settings: 'id, user_id',
      outbox: 'id, status, [entity+entity_id]',
      conflicts: '++seq, entity, seen',
      meta: 'key',
    });
  }
}

/** Tablas sincronizables presentes en la base local (crecen en cada fase). */
export const LOCAL_ENTITIES = ['profiles', 'user_settings'] as const;
export type LocalEntity = (typeof LOCAL_ENTITIES)[number];

export function tableFor(db: Fit20DB, entity: LocalEntity): Table<LocalProfile | LocalSettings, string> {
  return db.table(entity);
}

let current: Fit20DB | null = null;

export function openUserDB(userId: string): Fit20DB {
  if (current && current.name === `fit20-${userId}`) return current;
  current?.close();
  current = new Fit20DB(userId);
  return current;
}

export function closeUserDB(): void {
  current?.close();
  current = null;
}

export async function getMeta<T>(db: Fit20DB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(db: Fit20DB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
