import { ChartLine, Dumbbell, Footprints, House, Utensils } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { SyncBadge } from '@/components/SyncBadge';
import { Wordmark, cx } from '@/components/ui';
import { useProfile } from './data';
import { UpdateBanner } from './pwa';

const TABS = [
  { to: '/', label: 'Inicio', icon: House, end: true },
  { to: '/entrenar', label: 'Entrenar', icon: Dumbbell },
  { to: '/running', label: 'Running', icon: Footprints },
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

/** Pantalla de una sección que llega en una fase posterior. */
export function ComingSoon({ title, icon, description, items }: { title: string; icon: ReactNode; description: string; items: readonly string[] }) {
  return (
    <div className="pt-4">
      <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
      <div className="mt-6 rounded-3xl border border-dashed border-line p-6">
        <span className="grid size-12 place-items-center rounded-2xl bg-raised text-muted">{icon}</span>
        <p className="mt-4 text-[15px]">{description}</p>
        <ul className="mt-4 flex flex-col gap-2 text-[14px] text-muted">
          {items.map((i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-faint" />
              {i}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export const SECTIONS = {
  train: {
    title: 'Entrenar',
    icon: <Dumbbell className="size-6" />,
    description: 'Muy pronto: tu plan personalizado y las sesiones guiadas.',
    items: ['Generador de planes de 7 a 90 días', 'Sesión de fuerza con temporizador de descanso', 'Biblioteca de 106 ejercicios', 'Historial de entrenamientos'],
  },
  run: {
    title: 'Running',
    icon: <Footprints className="size-6" />,
    description: 'Muy pronto: registrá tus carreras con GPS o a mano.',
    items: ['Cronómetro y recorrido en el mapa', 'Parciales por kilómetro y ritmo', 'Marcas personales'],
  },
  food: {
    title: 'Nutrición',
    icon: <Utensils className="size-6" />,
    description: 'Muy pronto: registrá tus comidas con una base de 100 alimentos argentinos.',
    items: ['Buscador de alimentos y porciones', 'Registro por comida y agua', 'Objetivos diarios y comidas frecuentes'],
  },
  progress: {
    title: 'Progreso',
    icon: <ChartLine className="size-6" />,
    description: 'Muy pronto: seguí tu peso, medidas y fotos privadas.',
    items: ['Gráficos de peso y medidas', 'Fotos de progreso privadas', 'Comparación antes y después'],
  },
} as const;
