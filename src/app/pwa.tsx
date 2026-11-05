import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
const UPDATE_EVENT = 'fit20:update-ready';

/**
 * Registra el service worker: guarda la app (código, catálogo de ejercicios, mapa) para
 * abrirla sin internet. Las actualizaciones nunca interrumpen: se ofrecen con un aviso.
 */
export function setupPwa(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event(UPDATE_EVENT));
    },
    onRegisteredSW(_url, reg) {
      // Buscar versiones nuevas cada hora mientras la app está abierta.
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });
}

/** Aviso de nueva versión. No recarga solo: podría cortar una sesión o una carrera en curso. */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener(UPDATE_EVENT, on);
    return () => window.removeEventListener(UPDATE_EVENT, on);
  }, []);
  if (!ready) return null;
  return (
    <div role="status" className="mx-5 mb-2 flex items-center gap-3 rounded-2xl bg-raised px-4 py-3 text-[14px]">
      <span className="flex-1">Hay una versión nueva de FIT 20.</span>
      <button type="button" onClick={() => void applyUpdate?.(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent px-3 font-semibold text-accent-ink">
        <RefreshCw className="size-3.5" aria-hidden /> Actualizar
      </button>
      <button type="button" aria-label="Más tarde" onClick={() => setReady(false)} className="grid size-9 place-items-center rounded-full text-muted">
        <X className="size-4" />
      </button>
    </div>
  );
}
