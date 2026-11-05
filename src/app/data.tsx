import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Profile } from '@/types/domain';
import { type Fit20DB, type LocalProfile, type LocalSettings, type ThemePreference, type UserSettings, getMeta, openUserDB } from '@/lib/db/database';
import { saveRecord } from '@/lib/db/repository';
import { SyncEngine, type SyncSnapshot } from '@/lib/sync/engine';
import { supabase } from '@/lib/supabase';

export type SettingsValues = Omit<UserSettings, 'id' | 'user_id' | 'version' | 'updated_at' | 'deleted_at'>;

export const DEFAULT_SETTINGS: SettingsValues = {
  theme: 'dark',
  units: 'metric',
  notifications_enabled: false,
  sound_enabled: true,
  vibration_enabled: true,
  default_rest_seconds: 60,
  reminders: [],
  offline_enabled: true,
  nutrition_targets: null,
};

interface DataState {
  db: Fit20DB;
  sync: SyncEngine;
  userId: string;
  email: string;
  /** undefined = leyendo IndexedDB; null = todavía no hay perfil en este dispositivo. */
  profile: LocalProfile | null | undefined;
  settings: SettingsValues;
  /** Se descargaron los datos del servidor al menos una vez en este dispositivo. */
  initialPullDone: boolean | undefined;
  saveProfile: (p: Omit<Profile, 'version' | 'updated_at' | 'deleted_at'>) => Promise<void>;
  saveSettings: (patch: Partial<SettingsValues>) => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);

export function applyTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem('fit20:theme', theme);
  } catch {
    /* almacenamiento bloqueado: el tema igual se aplica en esta sesión */
  }
  const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f4f3ef' : '#111111');
}

export function DataProvider({ userId, email, children }: { userId: string; email: string; children: ReactNode }) {
  const db = useMemo(() => openUserDB(userId), [userId]);
  const sync = useMemo(() => new SyncEngine(db, supabase, userId), [db, userId]);

  useEffect(() => {
    void sync.start();
    return () => sync.stop();
  }, [sync]);

  const profile = useLiveQuery(async () => (await db.profiles.get(userId)) ?? null, [db, userId]);
  const storedSettings = useLiveQuery(() => db.user_settings.where('user_id').equals(userId).first(), [db, userId]);
  const initialPullDone = useLiveQuery(async () => (await getMeta<boolean>(db, 'initial_pull_done')) ?? false, [db]);

  const settings = useMemo<SettingsValues>(() => ({ ...DEFAULT_SETTINGS, ...stripMeta(storedSettings) }), [storedSettings]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  const saveProfile = useCallback<DataState['saveProfile']>(
    async (p) => {
      if (await saveRecord(db, 'profiles', { ...p, deleted_at: null })) sync.schedule();
    },
    [db, sync],
  );

  const saveSettings = useCallback<DataState['saveSettings']>(
    async (patch) => {
      const current = await db.user_settings.where('user_id').equals(userId).first();
      // id = id del usuario: un único registro de configuración por cuenta, idéntico en todos los dispositivos.
      const next = { ...DEFAULT_SETTINGS, ...stripMeta(current), ...patch, id: userId, user_id: userId, deleted_at: null };
      if (await saveRecord(db, 'user_settings', next)) sync.schedule();
    },
    [db, sync, userId],
  );

  const value = useMemo<DataState>(
    () => ({ db, sync, userId, email, profile, settings, initialPullDone, saveProfile, saveSettings }),
    [db, sync, userId, email, profile, settings, initialPullDone, saveProfile, saveSettings],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function stripMeta(s: LocalSettings | undefined): Partial<SettingsValues> {
  if (!s) return {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _i, user_id: _u, version: _v, updated_at: _t, deleted_at: _d, _server_version: _s, ...rest } = s;
  return rest;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData fuera de DataProvider');
  return ctx;
}

/** Perfil garantizado (solo en pantallas posteriores al onboarding). */
export function useProfile(): LocalProfile {
  const { profile } = useData();
  if (!profile) throw new Error('Perfil no disponible');
  return profile;
}

export function useSyncStatus(): SyncSnapshot & { retry: () => Promise<void> } {
  const { sync } = useData();
  const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  return { ...snap, retry: () => sync.retryNow() };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
