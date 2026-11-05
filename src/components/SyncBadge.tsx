import { Cloud, CloudAlert, CloudOff, CloudUpload, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '@/app/data';
import type { SyncState } from '@/lib/sync/engine';
import { cx } from './ui';

const LABELS: Record<SyncState, string> = {
  'no-backend': 'Solo en este dispositivo',
  offline: 'Sin conexión',
  syncing: 'Sincronizando…',
  pending: 'Pendiente de sincronizar',
  error: 'Error al sincronizar',
  synced: 'Sincronizado',
};

export function syncLabel(state: SyncState, pending: number): string {
  if ((state === 'offline' || state === 'pending') && pending > 0) return `${pending} ${pending === 1 ? 'cambio pendiente' : 'cambios pendientes'}`;
  return LABELS[state];
}

/** Indicador compacto del estado de sincronización (cabecera). */
export function SyncBadge() {
  const { state, pending } = useSyncStatus();
  const Icon = state === 'synced' ? Cloud : state === 'syncing' ? RefreshCw : state === 'error' ? CloudAlert : state === 'offline' || state === 'no-backend' ? CloudOff : CloudUpload;
  const label = syncLabel(state, pending);
  return (
    <span
      role="status"
      aria-live="polite"
      title={label}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium',
        state === 'synced' && 'text-muted',
        state === 'syncing' && 'text-muted',
        (state === 'pending' || state === 'offline' || state === 'no-backend') && 'bg-warn/12 text-warn',
        state === 'error' && 'bg-danger/12 text-danger',
      )}
    >
      <Icon className={cx('size-4', state === 'syncing' && 'animate-spin')} aria-hidden />
      <span className={cx(state === 'synced' || state === 'syncing' ? 'sr-only' : 'max-[360px]:sr-only')}>{label}</span>
    </span>
  );
}
