import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { useData } from '@/app/data';
import type { EntityName } from '@/core/sync/types';
import { type Fit20DB, LOCAL_ENTITIES, type LocalEntity, type StoredConflict, tableFor } from '@/lib/db/database';
import { saveRecord } from '@/lib/db/repository';

const ENTITY_LABEL: Partial<Record<EntityName | 'meal_plan_days', string>> = {
  profiles: 'Tu perfil',
  user_settings: 'Tus ajustes',
  training_plans: 'Un plan de entrenamiento',
  training_days: 'Un día del plan',
  workouts: 'Un entrenamiento',
  exercise_sets: 'Una serie',
  running_sessions: 'Una carrera',
  food_logs: 'Un registro de comida',
  water_logs: 'Un registro de agua',
  saved_meals: 'Una comida guardada',
  body_measurements: 'Un registro de peso o medidas',
  progress_photos: 'Una foto de progreso',
  meal_plan_days: 'Un día del plan de alimentación',
};

const FIELD_LABEL: Record<string, string> = {
  full_name: 'nombre',
  current_weight_kg: 'peso',
  target_weight_kg: 'peso objetivo',
  training_weekdays: 'días de entrenamiento',
  session_minutes: 'minutos por sesión',
  primary_goal: 'objetivo',
  theme: 'tema',
  nutrition_targets: 'objetivos de nutrición',
  status: 'estado',
  planned: 'contenido',
  notes: 'notas',
  meals: 'comidas',
  quantity: 'cantidad',
};

const fieldList = (fs: string[]) => fs.map((f) => FIELD_LABEL[f] ?? f.replace(/_/g, ' ')).join(', ');

/** Conflictos que vale la pena contar: los que se resolvieron solos sin perder nada no se muestran. */
export function useConflicts() {
  const { db } = useData();
  // (Los booleanos no son claves válidas de IndexedDB: se filtra en memoria; son pocos registros.)
  return useLiveQuery(() => db.conflicts.filter((c) => !c.seen && c.resolution !== 'rebased').toArray(), [db]);
}

/** Vuelve a aplicar los valores que tenía este dispositivo, sobre la versión actual. */
export async function restoreLocal(db: Fit20DB, c: StoredConflict): Promise<boolean> {
  if (!(LOCAL_ENTITIES as readonly string[]).includes(c.entity)) return false;
  const table = tableFor(db, c.entity as LocalEntity);
  const current = await table.get(c.entity_id);
  if (!current) return false;
  const patch: Record<string, unknown> = {};
  for (const f of c.fields) patch[f] = c.local[f];
  return saveRecord(db, c.entity as LocalEntity, { ...current, ...patch });
}

export function ConflictsList() {
  const { db, sync } = useData();
  const list = useConflicts();
  const [busy, setBusy] = useState<number | null>(null);
  if (!list?.length) return null;

  const dismiss = (c: StoredConflict) => db.conflicts.update(c.seq!, { seen: true });

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-[14px] font-semibold">Cambios hechos en dos dispositivos a la vez</p>
      {list.map((c) => (
        <div key={c.seq} className="rounded-2xl border border-warn/40 p-3 text-[14px]">
          <p>
            <strong>{ENTITY_LABEL[c.entity] ?? c.entity}</strong>{' '}
            {c.resolution === 'server_kept' && <>se editó en otro dispositivo ({fieldList(c.fields)}). Se mantuvo esa versión.</>}
            {c.resolution === 'local_won' && <>se editó en otro dispositivo ({fieldList(c.fields)}). Quedó tu cambio más reciente.</>}
            {c.resolution === 'deleted_remotely' && <>se borró en otro dispositivo; tu cambio no se aplicó.</>}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">{new Date(c.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</p>
          <div className="mt-2 flex gap-2">
            {c.resolution === 'server_kept' && (
              <Button
                variant="secondary"
                className="min-h-10 flex-1 text-[13px]"
                loading={busy === c.seq}
                onClick={async () => {
                  setBusy(c.seq!);
                  await restoreLocal(db, c);
                  await dismiss(c);
                  sync.schedule();
                  setBusy(null);
                }}
              >
                Usar la de este dispositivo
              </Button>
            )}
            <Button variant="ghost" className="min-h-10 flex-1 text-[13px]" onClick={() => void dismiss(c)}>
              Entendido
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
