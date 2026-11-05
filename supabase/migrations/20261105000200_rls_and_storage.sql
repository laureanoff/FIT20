-- ═══════════════════════════════════════════════════════════════════
-- FIT 20 · 002 · Row Level Security + Storage privado
-- Regla: cada usuario solo ve y modifica sus propios datos.
-- Los catálogos globales (owner_id null) son de solo lectura para usuarios autenticados.
-- `(select auth.uid())` se evalúa una vez por consulta (recomendación de rendimiento de Supabase).
-- ═══════════════════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.exercises enable row level security;
alter table public.food_items enable row level security;
alter table public.exercise_favorites enable row level security;
alter table public.training_plans enable row level security;
alter table public.training_days enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.exercise_sets enable row level security;
alter table public.running_sessions enable row level security;
alter table public.running_splits enable row level security;
alter table public.running_tracks enable row level security;
alter table public.food_logs enable row level security;
alter table public.saved_meals enable row level security;
alter table public.water_logs enable row level security;
alter table public.body_measurements enable row level security;
alter table public.progress_photos enable row level security;

-- ───────── Perfil (id = usuario) ─────────

create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Sin DELETE: la cuenta se elimina por la Edge Function delete-account (borra en cascada).

-- ───────── Tablas propias simples ─────────

do $$
declare t text;
begin
  foreach t in array array['user_settings', 'exercise_favorites', 'training_plans', 'workouts', 'running_sessions',
                           'saved_meals', 'water_logs', 'body_measurements', 'progress_photos']
  loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ───────── Tablas hijas: además, el padre debe ser del mismo usuario ─────────
-- Evita colgar registros propios de un plan/entrenamiento/carrera ajeno adivinando su UUID.

create or replace function public.fit20_owns(parent regclass, parent_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare ok boolean;
begin
  execute format('select exists (select 1 from %s where id = $1 and user_id = auth.uid())', parent) into ok using parent_id;
  return ok;
end;
$$;

do $$
declare
  rel record;
begin
  for rel in select * from (values
    ('training_days', 'training_plans', 'plan_id'),
    ('workout_exercises', 'workouts', 'workout_id'),
    ('exercise_sets', 'workout_exercises', 'workout_exercise_id'),
    ('running_splits', 'running_sessions', 'session_id'),
    ('running_tracks', 'running_sessions', 'session_id')
  ) as v(child, parent, fk)
  loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (user_id = (select auth.uid()))', rel.child);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (user_id = (select auth.uid()) and public.fit20_owns(%2$L::regclass, %3$I))', rel.child, 'public.' || rel.parent, rel.fk);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.fit20_owns(%2$L::regclass, %3$I))', rel.child, 'public.' || rel.parent, rel.fk);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (user_id = (select auth.uid()))', rel.child);
  end loop;
end $$;

-- Referencias opcionales a días del plan (workouts / running_sessions): el día debe ser propio.
create policy workouts_day_owner on public.workouts as restrictive for all to authenticated
  using (true)
  with check (training_day_id is null or public.fit20_owns('public.training_days'::regclass, training_day_id));
create policy running_sessions_day_owner on public.running_sessions as restrictive for all to authenticated
  using (true)
  with check (training_day_id is null or public.fit20_owns('public.training_days'::regclass, training_day_id));

-- ───────── Comidas: el alimento debe ser global o propio ─────────

create policy food_logs_select on public.food_logs for select to authenticated using (user_id = (select auth.uid()));
create policy food_logs_insert on public.food_logs for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.food_items f where f.id = food_item_id and (f.owner_id is null or f.owner_id = (select auth.uid())))
);
create policy food_logs_update on public.food_logs for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.food_items f where f.id = food_item_id and (f.owner_id is null or f.owner_id = (select auth.uid())))
);
create policy food_logs_delete on public.food_logs for delete to authenticated using (user_id = (select auth.uid()));

-- ───────── Catálogos: globales de solo lectura + personalizados propios ─────────

create policy exercises_select on public.exercises for select to authenticated using (owner_id is null or owner_id = (select auth.uid()));
create policy exercises_insert on public.exercises for insert to authenticated with check (owner_id = (select auth.uid()) and id like 'custom-%');
create policy exercises_update on public.exercises for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy exercises_delete on public.exercises for delete to authenticated using (owner_id = (select auth.uid()));

create policy food_items_select on public.food_items for select to authenticated using (owner_id is null or owner_id = (select auth.uid()));
create policy food_items_insert on public.food_items for insert to authenticated with check (owner_id = (select auth.uid()) and id like 'custom-%');
create policy food_items_update on public.food_items for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy food_items_delete on public.food_items for delete to authenticated using (owner_id = (select auth.uid()));

-- Los anónimos no acceden a nada (no hay políticas para el rol anon).

-- ───────── Storage: fotos de progreso en bucket PRIVADO ─────────
-- Ruta obligatoria: {user_id}/{photo_id}.{ext}. Solo se acceden con URL firmada temporal.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy progress_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy progress_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy progress_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy progress_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
