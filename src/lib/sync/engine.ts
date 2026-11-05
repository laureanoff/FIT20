import type { SupabaseClient } from '@supabase/supabase-js';
import { processQueue, pruneSynced, queueStats, recoverInterrupted, resolvePulled, retryFailed } from '@/core/sync/queue';
import type { ServerRecord } from '@/core/sync/types';
import { type Fit20DB, LOCAL_ENTITIES, type LocalEntity, getMeta, setMeta, tableFor } from '@/lib/db/database';
import { markApplied, outboxStore, replaceWithServer } from '@/lib/db/repository';
import { syncPhotoFiles } from './photos';
import { SupabaseRemote, type SupabaseLike } from './supabase-remote';

export type SyncState = 'no-backend' | 'offline' | 'syncing' | 'pending' | 'error' | 'synced';

export interface SyncSnapshot {
  state: SyncState;
  pending: number;
  errors: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

const PULL_PAGE = 500;
const PERIODIC_MS = 60_000;

/**
 * Orquesta la sincronización en la app: sube la cola (núcleo `processQueue`) y descarga
 * cambios del servidor por cursor de `updated_at`. Se dispara al iniciar, al reconectar,
 * al volver a la pestaña, tras cada guardado local (con demora corta) y cada minuto.
 */
export class SyncEngine {
  private snapshot: SyncSnapshot = { state: 'pending', pending: 0, errors: 0, lastSyncAt: null, lastError: null };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly remote: SupabaseRemote | null;
  private cycling = false;

  constructor(
    private readonly db: Fit20DB,
    private readonly client: SupabaseClient | null,
    userId: string,
  ) {
    this.remote = client ? new SupabaseRemote(client as unknown as SupabaseLike, () => userId) : null;
  }

  // ── Suscripción para React (useSyncExternalStore) ──
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  private set(patch: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  private generation = 0;

  async start(): Promise<void> {
    const gen = ++this.generation;
    await recoverInterrupted(outboxStore(this.db));
    if (gen !== this.generation) return; // stop() llegó mientras arrancaba (p. ej. StrictMode)
    window.addEventListener('online', this.onWake);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.interval = setInterval(() => void this.run(), PERIODIC_MS);
    await this.run();
  }

  stop(): void {
    this.generation++;
    window.removeEventListener('online', this.onWake);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.interval) clearInterval(this.interval);
    if (this.debounce) clearTimeout(this.debounce);
  }

  private onWake = () => void this.run();
  private onOffline = () => void this.refreshCounts();
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.run();
  };

  /** Llamar después de cada guardado local. */
  schedule(delayMs = 1500): void {
    void this.refreshCounts();
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.run(), delayMs);
  }

  async retryNow(): Promise<void> {
    await retryFailed(outboxStore(this.db), Date.now());
    await this.run();
  }

  /** Ejecuta un ciclo completo; si ya hay uno en curso, encadena otro al terminar. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.cycle().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.run();
      }
    });
    return this.running;
  }

  private async cycle(): Promise<void> {
    if (!this.client || !this.remote) return this.set({ state: 'no-backend' });
    if (!navigator.onLine) return this.refreshCounts();

    this.cycling = true;
    this.set({ state: 'syncing' });
    const store = outboxStore(this.db);
    try {
      const summary = await processQueue(
        store,
        this.remote,
        {
          onApplied: (op, record) => markApplied(this.db, op.entity as LocalEntity, record),
          onServerKept: (op, server) => replaceWithServer(this.db, op.entity as LocalEntity, server),
          onConflict: async (ev) => {
            await this.db.conflicts.add({ ...ev, seen: false });
          },
        },
        Date.now,
      );
      if (!summary.stopped_offline) {
        await this.pull();
        // Fotos de progreso: archivos aparte de la cola de registros.
        try {
          await syncPhotoFiles(this.db, this.client);
        } catch {
          /* se reintenta en el próximo ciclo */
        }
      }
      await pruneSynced(store, Date.now());
      const lastError = summary.failed ? ((await store.list()).find((o) => o.status === 'error')?.last_error ?? null) : null;
      this.set({ lastSyncAt: summary.stopped_offline ? this.snapshot.lastSyncAt : Date.now(), lastError });
    } catch (e) {
      this.set({ lastError: e instanceof Error ? e.message : String(e) });
    }
    this.cycling = false;
    await this.refreshCounts();
  }

  /** Descarga incremental por `updated_at`. Nunca pisa un registro con cambios locales sin subir. */
  async pull(): Promise<void> {
    if (!this.client) return;
    const open = new Set(
      (await this.db.outbox.toArray()).filter((o) => o.status === 'pending' || o.status === 'error' || o.status === 'syncing').map((o) => `${o.entity}:${o.entity_id}`),
    );
    for (const entity of LOCAL_ENTITIES) {
      const cursorKey = `pull:${entity}`;
      let cursor = (await getMeta<string>(this.db, cursorKey)) ?? '1970-01-01T00:00:00Z';
      for (;;) {
        const { data, error } = await this.client.from(entity).select('*').gt('updated_at', cursor).order('updated_at').limit(PULL_PAGE);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as ServerRecord[];
        const table = tableFor(this.db, entity);
        for (const row of rows) {
          const local = (await table.get(row.id)) as { version: number; _server_version: number | null } | undefined;
          const action = resolvePulled(local ? { version: local._server_version ?? 0 } : undefined, row, open.has(`${entity}:${row.id}`));
          if (action !== 'keep') await replaceWithServer(this.db, entity, row);
        }
        if (rows.length) {
          cursor = rows[rows.length - 1]!.updated_at;
          await setMeta(this.db, cursorKey, cursor);
        }
        if (rows.length < PULL_PAGE) break;
      }
    }
    await setMeta(this.db, 'initial_pull_done', true);
  }

  async refreshCounts(): Promise<void> {
    const s = await queueStats(outboxStore(this.db));
    const photos = await this.db.photo_blobs.where('state').anyOf('pending', 'delete').count();
    const pending = s.pending + s.syncing + photos;
    let state: SyncState;
    if (!this.client) state = 'no-backend';
    else if (!navigator.onLine) state = 'offline';
    else if (this.cycling) state = 'syncing';
    else if (s.error) state = 'error';
    else if (pending) state = 'pending';
    else state = 'synced';
    this.set({ state, pending: pending + s.error, errors: s.error });
  }
}
