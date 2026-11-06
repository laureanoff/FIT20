import { Bell, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { currentSubscription, pushSupport } from './push';

const KEY = 'fit20:notify-promo-dismissed';

/** Invitación (descartable) a activar los avisos, en Inicio. */
export function NotifyPromo() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === '1';
    } catch {
      /* sin almacenamiento: mostrar igual */
    }
    const s = pushSupport();
    if (dismissed || s === 'unsupported' || s === 'dev') return;
    void currentSubscription().then((sub) => setShow(!sub));
  }, []);
  if (!show) return null;
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
        <Bell className="size-5" aria-hidden />
      </span>
      <Link to="/perfil/notificaciones" className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">Activá los avisos</span>
        <span className="block text-[13px] text-muted">Tu sesión del día y el clima, cada mañana.</span>
      </Link>
      <Link to="/perfil/notificaciones" aria-label="Configurar avisos" className="grid size-9 place-items-center rounded-full bg-raised">
        <ChevronRight className="size-4" />
      </Link>
      <button
        type="button"
        aria-label="Ocultar"
        onClick={() => {
          try {
            localStorage.setItem(KEY, '1');
          } catch {
            /* nada */
          }
          setShow(false);
        }}
        className="grid size-9 place-items-center rounded-full text-faint"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
