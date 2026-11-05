import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Dumbbell, Flame, Timer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Card, Spinner } from '@/components/ui';
import { useData } from '@/app/data';
import { getExercise } from '@/data/exercises';
import { type ExerciseSet, type L, alive } from '@/lib/db/database';
import { dateLabel, durationLabel } from './format';
import { BackLink } from './LibraryScreens';

/** Volumen = Σ kg × repeticiones (solo series con carga). */
export function volumeKg(sets: readonly Pick<ExerciseSet, 'weight_kg' | 'repetitions_completed'>[]): number {
  return Math.round(sets.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.repetitions_completed ?? 0), 0));
}

export function HistoryScreen() {
  const { db } = useData();
  const items = useLiveQuery(async () => {
    const ws = (await db.workouts.toArray()).filter((w) => alive(w) && w.status === 'completed').sort((a, b) => b.started_at.localeCompare(a.started_at));
    return Promise.all(
      ws.map(async (w) => {
        const wes = (await db.workout_exercises.where('workout_id').equals(w.id).toArray()).filter(alive);
        const sets = wes.length ? (await db.exercise_sets.where('workout_exercise_id').anyOf(wes.map((e) => e.id)).toArray()).filter(alive) : [];
        return { w, sets: sets.length, exercises: wes.length };
      }),
    );
  }, [db]);

  if (!items) return <Spinner />;
  const months = new Map<string, typeof items>();
  for (const it of items) {
    const k = it.w.started_at.slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), it]);
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/entrenar" label="Entrenar" />
        <h1 className="mt-1 text-[26px] font-bold tracking-tight">Historial</h1>
        <p className="text-[14px] text-muted">
          {items.length} {items.length === 1 ? 'entrenamiento completado' : 'entrenamientos completados'}
        </p>
      </div>
      {items.length === 0 && <p className="rounded-3xl border border-dashed border-line p-6 text-center text-[14px] text-muted">Cuando termines tu primera sesión, aparece acá con todas tus series.</p>}
      {[...months].map(([month, list]) => (
        <section key={month}>
          <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">{dateLabel(`${month}-01`, { month: 'long', year: 'numeric' })}</h2>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {list.map(({ w, sets, exercises }) => (
                <li key={w.id}>
                  <Link to={`/entrenar/historial/${w.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3">
                    <span className="flex w-10 flex-col items-center leading-none">
                      <span className="num text-[18px] font-bold">{new Date(w.started_at).getDate()}</span>
                      <span className="text-[11px] text-muted">{new Date(w.started_at).toLocaleDateString('es-AR', { weekday: 'short' })}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{w.name}</span>
                      <span className="block text-[13px] text-muted">
                        {w.duration_seconds !== null ? durationLabel(w.duration_seconds) : '—'} · {exercises} ejercicios · {sets} series{w.rpe ? ` · RPE ${w.rpe}` : ''}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}

export function WorkoutDetailScreen() {
  const { id } = useParams();
  const { db } = useData();
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const w = await db.workouts.get(id);
    if (!alive(w)) return null;
    const wes = (await db.workout_exercises.where('workout_id').equals(id).toArray()).filter(alive).sort((a, b) => a.order_index - b.order_index);
    const sets = wes.length ? (await db.exercise_sets.where('workout_exercise_id').anyOf(wes.map((e) => e.id)).toArray()).filter(alive) : [];
    return { w, wes, sets };
  }, [db, id]);

  if (data === undefined) return <Spinner />;
  if (!data) return <p className="pt-6 text-muted">Entrenamiento no encontrado.</p>;
  const { w, wes, sets } = data;
  const vol = volumeKg(sets);
  const byWe = (weId: string) => sets.filter((s) => s.workout_exercise_id === weId).sort((a, b) => a.set_number - b.set_number);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <BackLink to="/entrenar/historial" label="Historial" />
        <p className="mt-1 text-[13px] font-semibold text-muted uppercase">{dateLabel(w.started_at.slice(0, 10))}</p>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">{w.name}</h1>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat icon={<Timer className="size-4" />} value={w.duration_seconds !== null ? durationLabel(w.duration_seconds) : '—'} label="Duración" />
        <Stat icon={<Dumbbell className="size-4" />} value={String(sets.length)} label="Series" />
        <Stat icon={<Flame className="size-4" />} value={vol ? `${vol.toLocaleString('es-AR')} kg` : w.rpe ? `RPE ${w.rpe}` : '—'} label={vol ? 'Volumen' : 'Esfuerzo'} />
      </div>
      {w.notes && <Card><p className="text-[15px] whitespace-pre-wrap">{w.notes}</p></Card>}
      <Card className="p-0">
        <h2 className="px-5 pt-4 text-[13px] font-semibold tracking-wide text-muted uppercase">Ejercicios</h2>
        <ul className="divide-y divide-line">
          {wes.map((we) => {
            const list = byWe(we.id);
            return (
              <li key={we.id} className="px-5 py-3">
                <Link to={`/entrenar/ejercicio/${we.exercise_id}`} className="text-[15px] font-medium">
                  {getExercise(we.exercise_id)?.name ?? we.exercise_id}
                </Link>
                {list.length ? (
                  <ol className="mt-1.5 flex flex-wrap gap-1.5">
                    {list.map((s: L<ExerciseSet>) => (
                      <li key={s.id} className="num rounded-lg bg-raised px-2 py-1 text-[13px]">
                        {s.weight_kg ? `${s.weight_kg.toLocaleString('es-AR')} kg × ` : ''}
                        {s.repetitions_completed !== null ? `${s.repetitions_completed} rep` : `${s.duration_seconds} s`}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[13px] text-faint">Sin series registradas</p>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <span className="text-muted">{icon}</span>
      <div className="num mt-1 text-[17px] font-semibold">{value}</div>
      <div className="text-[12px] text-muted">{label}</div>
    </div>
  );
}
