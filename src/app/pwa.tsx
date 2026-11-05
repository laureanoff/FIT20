import { Download, RefreshCw, Share, X } from 'lucide-react';
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

// ───────── Instalación ─────────

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const INSTALL_EVENT = 'fit20:install-ready';
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // mostramos nuestro propio botón en lugar del aviso del navegador
    deferred = e as InstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_EVENT));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    window.dispatchEvent(new Event(INSTALL_EVENT));
  });
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

const DISMISS_KEY = 'fit20:install-dismissed';

/** Invita a instalar la app (pantalla de inicio): necesaria en iPhone para usarla como app y sin conexión. */
export function InstallCard() {
  const [, force] = useState(0);
  const [hidden, setHidden] = useState(() => {
    try {
      return isStandalone() || localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return isStandalone();
    }
  });
  useEffect(() => {
    const on = () => force((n) => n + 1);
    window.addEventListener(INSTALL_EVENT, on);
    return () => window.removeEventListener(INSTALL_EVENT, on);
  }, []);
  if (hidden || isStandalone()) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sin almacenamiento */
    }
    setHidden(true);
  };

  return (
    <section className="relative rounded-3xl border border-line bg-surface p-5">
      <button type="button" aria-label="Ocultar" onClick={dismiss} className="absolute top-3 right-3 grid size-9 place-items-center rounded-full text-faint">
        <X className="size-4" />
      </button>
      <p className="pr-8 text-[16px] font-bold">Instalá FIT20 en tu teléfono</p>
      <p className="mt-1 text-[14px] text-muted">Se abre como una app, a pantalla completa, y funciona sin internet.</p>
      {deferred ? (
        <button
          type="button"
          onClick={async () => {
            await deferred?.prompt();
            const choice = await deferred?.userChoice;
            if (choice?.outcome === 'accepted') setHidden(true);
            deferred = null;
          }}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-accent px-4 text-[14px] font-semibold text-accent-ink"
        >
          <Download className="size-4" aria-hidden /> Instalar
        </button>
      ) : isIos() ? (
        <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-[14px]">
          <li>
            Abrí esta página en <strong>Safari</strong>.
          </li>
          <li>
            Tocá <Share className="inline size-4 align-text-bottom" aria-label="Compartir" /> <strong>Compartir</strong>.
          </li>
          <li>
            Elegí <strong>Agregar a inicio</strong>.
          </li>
        </ol>
      ) : (
        <p className="mt-3 text-[14px]">
          En Chrome: menú <strong>⋮</strong> → <strong>Instalar app</strong> (o “Agregar a la pantalla principal”).
        </p>
      )}
    </section>
  );
}
