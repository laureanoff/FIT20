import { ChartLine, Dumbbell, Footprints, House, Utensils } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { SyncBadge } from '@/components/SyncBadge';
import { Wordmark, cx } from '@/components/ui';
import { useProfile } from './data';
import { UpdateBanner } from './pwa';

const TABS = [
  { to: '/', label: 'Inicio', icon: House, end: true },
  { to: '/entrenar', label: 'Entrenar', icon: Dumbbell },
  { to: '/running', label: 'Cardio', icon: Footprints },
  { to: '/nutricion', label: 'Nutrición', icon: Utensils },
  { to: '/progreso', label: 'Progreso', icon: ChartLine },
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function AppLayout() {
  const profile = useProfile();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="pt-safe sticky top-0 z-20 bg-bg/90 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-5">
          <Link to="/" aria-label="Inicio">
            <Wordmark className="text-[19px]" />
          </Link>
          <div className="flex items-center gap-2">
            <SyncBadge />
            <Link to="/perfil" aria-label="Perfil y ajustes" className="grid size-9 place-items-center rounded-full bg-raised text-[13px] font-bold">
              {initials(profile.full_name)}
            </Link>
          </div>
        </div>
      </header>

      <UpdateBanner />
      <main className="flex-1 px-5 pt-2 pb-28">
        <Outlet />
      </main>

      <nav aria-label="Secciones" className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 backdrop-blur-md">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => cx('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-ink' : 'text-faint')}>
                {({ isActive }) => (
                  <>
                    <span className={cx('grid h-7 w-12 place-items-center rounded-full transition-colors', isActive && 'bg-accent text-accent-ink')}>
                      <Icon className="size-[19px]" aria-hidden />
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
