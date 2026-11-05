import { ArrowLeft, ChevronRight, Heart, Search, ShieldAlert, TriangleAlert } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, Chip, SectionTitle, cx } from '@/components/ui';
import { useProfile } from '@/app/data';
import { INJURY_LABELS } from '@/app/labels';
import { EQUIPMENT_LABELS, EXERCISES, MUSCLE_LABELS, getExercise, isAvailable } from '@/data/exercises';
import type { Exercise, MuscleGroup } from '@/types/domain';
import { toggleFavorite } from './actions';
import { useCtx, useFavorites } from './hooks';

const MUSCLE_FILTERS: MuscleGroup[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'abs', 'quads', 'hamstrings', 'glutes', 'calves', 'cardio', 'mobility', 'stretching'];

/** Normaliza para buscar sin tildes ni mayúsculas. */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function filterExercises(list: readonly Exercise[], q: string, muscle: MuscleGroup | null, onlyMine: readonly Exercise['equipment'][number][] | null, favorites: Set<string> | null): Exercise[] {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  return list
    .filter((e) => !muscle || e.primary_muscle === muscle || e.secondary_muscles.includes(muscle))
    .filter((e) => !onlyMine || isAvailable(e, onlyMine))
    .filter((e) => !favorites || favorites.has(e.id))
    .filter((e) => {
      if (!terms.length) return true;
      const hay = norm(`${e.name} ${MUSCLE_LABELS[e.primary_muscle]} ${e.secondary_muscles.map((m) => MUSCLE_LABELS[m]).join(' ')}`);
      return terms.every((t) => hay.includes(t));
    })
    .sort((a, b) => (muscle ? Number(b.primary_muscle === muscle) - Number(a.primary_muscle === muscle) : 0) || a.name.localeCompare(b.name, 'es'));
}

export function Difficulty({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Dificultad ${level} de 3`} title={['Fácil', 'Intermedio', 'Exigente'][level - 1]}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cx('h-2.5 w-1.5 rounded-sm', i <= level ? 'bg-accent' : 'bg-raised')} />
      ))}
    </span>
  );
}

export function ExerciseRow({ ex, to, right, sub }: { ex: Exercise; to: string; right?: ReactNode; sub?: string }) {
  return (
    <Link to={to} className="flex min-h-16 items-center gap-3 px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-raised text-[12px] font-bold text-muted">{MUSCLE_LABELS[ex.primary_muscle].slice(0, 3).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[15px] leading-snug font-medium">{ex.name}</span>
        <span className={cx('block text-[13px] text-muted', !sub && 'truncate')}>{sub ?? `${MUSCLE_LABELS[ex.primary_muscle]} · ${ex.equipment.map((e) => EQUIPMENT_LABELS[e]).join(' / ')}`}</span>
      </span>
      {right ?? <Difficulty level={ex.difficulty} />}
      <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
    </Link>
  );
}

export function LibraryScreen() {
  const profile = useProfile();
  const favorites = useFavorites();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [onlyMine, setOnlyMine] = useState(true);
  const [onlyFav, setOnlyFav] = useState(false);

  const results = useMemo(
    () => filterExercises(EXERCISES, q, muscle, onlyMine ? profile.equipment : null, onlyFav ? (favorites ?? new Set()) : null),
    [q, muscle, onlyMine, onlyFav, favorites, profile.equipment],
  );

  return (
    <div className="pt-2">
      <BackLink to="/entrenar" label="Entrenar" />
      <h1 className="mt-1 text-[26px] font-bold tracking-tight">Biblioteca</h1>
      <p className="text-[14px] text-muted">{EXERCISES.length} ejercicios con técnica, errores comunes y variantes.</p>

      <label className="mt-5 flex min-h-12 items-center gap-2 rounded-xl border border-line bg-surface px-4 focus-within:border-accent">
        <Search className="size-4 text-muted" aria-hidden />
        <span className="sr-only">Buscar ejercicio</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: sentadilla, espalda…" className="w-full bg-transparent text-[16px] outline-none placeholder:text-faint" />
      </label>

      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
        <Chip selected={onlyMine} onClick={() => setOnlyMine((v) => !v)} className="shrink-0">
          Con mi equipo
        </Chip>
        <Chip selected={onlyFav} onClick={() => setOnlyFav((v) => !v)} className="shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <Heart className="size-3.5" aria-hidden /> Favoritos
          </span>
        </Chip>
        {MUSCLE_FILTERS.map((m) => (
          <Chip key={m} selected={muscle === m} onClick={() => setMuscle(muscle === m ? null : m)} className="shrink-0">
            {MUSCLE_LABELS[m]}
          </Chip>
        ))}
      </div>

      <p className="mt-4 mb-2 text-[13px] text-muted" aria-live="polite">
        {results.length} {results.length === 1 ? 'resultado' : 'resultados'}
      </p>
      {results.length ? (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {results.map((ex) => (
              <li key={ex.id}>
                <ExerciseRow ex={ex} to={`/entrenar/ejercicio/${ex.id}`} right={favorites?.has(ex.id) ? <Heart className="size-4 fill-accent text-accent" aria-label="Favorito" /> : undefined} />
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <p className="rounded-3xl border border-dashed border-line p-6 text-center text-[14px] text-muted">
          No hay ejercicios con esos filtros.{onlyFav ? ' Marcá favoritos con el corazón en cada ejercicio.' : ''}
        </p>
      )}
    </div>
  );
}

export function BackLink({ to, label }: { to?: string; label: string }) {
  const navigate = useNavigate();
  const cls = '-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[14px] text-muted';
  return to ? (
    <Link to={to} className={cls}>
      <ArrowLeft className="size-4" aria-hidden /> {label}
    </Link>
  ) : (
    <button type="button" onClick={() => navigate(-1)} className={cls}>
      <ArrowLeft className="size-4" aria-hidden /> {label}
    </button>
  );
}

const TYPE_LABELS: Record<Exercise['type'], string> = {
  strength: 'Fuerza',
  core: 'Core',
  cardio: 'Cardio',
  mobility: 'Movilidad',
  stretch: 'Estiramiento',
  plyometric: 'Pliometría',
};

export function ExerciseDetailScreen() {
  const { id } = useParams();
  const ex = id ? getExercise(id) : undefined;
  const profile = useProfile();
  const favorites = useFavorites();
  const ctx = useCtx();

  if (!ex) return <p className="pt-6 text-muted">Ejercicio no encontrado.</p>;
  const fav = favorites?.has(ex.id) ?? false;
  const available = isAvailable(ex, profile.equipment);
  const risky = ex.stress_regions.filter((r) => profile.injuries.includes(r));
  const variant = (ids: string[]) => ids.map(getExercise).filter((e): e is Exercise => !!e);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink label="Volver" />
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="text-[26px] leading-tight font-bold tracking-tight">{ex.name}</h1>
          <button
            type="button"
            aria-pressed={fav}
            aria-label={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
            onClick={() => void toggleFavorite(ctx, ex.id, !fav)}
            className={cx('grid size-11 shrink-0 place-items-center rounded-full', fav ? 'bg-accent text-accent-ink' : 'bg-raised text-muted')}
          >
            <Heart className={cx('size-5', fav && 'fill-current')} />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span className="rounded-full bg-raised px-2.5 py-1">{TYPE_LABELS[ex.type]}</span>
          <span className="rounded-full bg-raised px-2.5 py-1">{MUSCLE_LABELS[ex.primary_muscle]}</span>
          {ex.secondary_muscles.map((m) => (
            <span key={m} className="rounded-full border border-line px-2.5 py-1">
              {MUSCLE_LABELS[m]}
            </span>
          ))}
          <Difficulty level={ex.difficulty} />
        </div>
        <p className="mt-4 text-[15px] leading-relaxed">{ex.description}</p>
        <p className="mt-2 text-[13px] text-muted">Equipamiento: {ex.equipment.map((e) => EQUIPMENT_LABELS[e]).join(' o ')}</p>
      </div>

      {(!available || risky.length > 0) && (
        <div className="flex flex-col gap-2">
          {!available && <p className="rounded-2xl bg-warn/12 px-4 py-3 text-[14px] text-warn">No tenés el equipamiento para este ejercicio según tu perfil.</p>}
          {risky.length > 0 && (
            <p className="flex gap-2 rounded-2xl bg-danger/12 px-4 py-3 text-[14px] text-danger">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              Carga zonas que marcaste para cuidar ({risky.map((r) => INJURY_LABELS[r]).join(', ')}). El plan no lo incluye.
            </p>
          )}
        </div>
      )}

      <Card>
        <SectionTitle>Cómo hacerlo</SectionTitle>
        <ol className="flex flex-col gap-3">
          {ex.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-[15px]">
              <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[12px] font-bold text-accent-ink">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <SectionTitle>Errores comunes</SectionTitle>
        <ul className="flex flex-col gap-2 text-[15px]">
          {ex.common_mistakes.map((m) => (
            <li key={m} className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              {m}
            </li>
          ))}
        </ul>
        {ex.safety.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">Seguridad</h3>
            <ul className="flex flex-col gap-2 text-[15px]">
              {ex.safety.map((m) => (
                <li key={m} className="flex gap-2">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                  {m}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {(ex.easier.length > 0 || ex.harder.length > 0) && (
        <Card className="p-0">
          {[
            ['Más fácil', variant(ex.easier)],
            ['Más difícil', variant(ex.harder)],
          ].map(([label, list]) =>
            (list as Exercise[]).length ? (
              <div key={label as string}>
                <h2 className="px-5 pt-4 text-[13px] font-semibold tracking-wide text-muted uppercase">{label as string}</h2>
                <ul className="divide-y divide-line">
                  {(list as Exercise[]).map((v) => (
                    <li key={v.id}>
                      <ExerciseRow ex={v} to={`/entrenar/ejercicio/${v.id}`} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </Card>
      )}
    </div>
  );
}
