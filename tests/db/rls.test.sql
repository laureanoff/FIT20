-- Pruebas de seguridad y sincronización sobre las migraciones reales.
-- Cada bloque falla con una excepción si una garantía no se cumple.
\set ON_ERROR_STOP on
\set A '''aaaaaaaa-0000-4000-8000-000000000001'''
\set B '''bbbbbbbb-0000-4000-8000-000000000002'''

insert into auth.users (id, email) values (:A, 'a@test'), (:B, 'b@test');

-- ─── Usuario A crea sus datos ───
set role authenticated;
select set_config('request.jwt.claim.sub', :A, false);

insert into public.profiles (id, full_name, height_cm, current_weight_kg) values (:A, 'Ana', 165, 62);
insert into public.training_plans (id, name, goal, input, duration_days, start_date, end_date)
  values ('11111111-0000-4000-8000-000000000001', 'Plan A', 'fitness', '{}', 7, '2026-11-09', '2026-11-15');
insert into public.training_days (id, plan_id, date, day_number, session_type, planned)
  values ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', '2026-11-09', 1, 'strength', '{}');
insert into public.food_logs (id, food_item_id, log_date, meal_type, quantity, unit, grams, food_name, calories, protein, carbohydrates, fats, logged_at)
  values ('33333333-0000-4000-8000-000000000001', 'arroz-blanco-cocido', '2026-11-05', 'lunch', 200, 'g', 200, 'Arroz', 260, 5.4, 56, 0.6, now());
insert into public.running_sessions (id, session_date, source, distance_km, duration_seconds)
  values ('44444444-0000-4000-8000-000000000001', '2026-11-05', 'manual', 5, 1500);

do $$ begin
  -- user_id se completa solo con auth.uid()
  if (select user_id from public.food_logs) <> auth.uid() then raise exception 'user_id por defecto incorrecto'; end if;
  -- ritmo calculado en el servidor
  if (select average_pace_s from public.running_sessions) <> 300 then raise exception 'ritmo mal calculado'; end if;
  -- catálogo global visible
  if (select count(*) from public.exercises) < 80 then raise exception 'catálogo de ejercicios no visible'; end if;
  if (select count(*) from public.food_items) < 50 then raise exception 'catálogo de alimentos no visible'; end if;
end $$;

-- ─── Versionado: el servidor controla version/updated_at ───
do $$
declare v int;
begin
  update public.food_logs set quantity = 250, version = 999 where id = '33333333-0000-4000-8000-000000000001';
  select version into v from public.food_logs where id = '33333333-0000-4000-8000-000000000001';
  if v <> 2 then raise exception 'version debería ser 2 y es %', v; end if;
  -- Update condicionado a la versión base (control optimista): con base vieja no afecta filas.
  update public.food_logs set quantity = 300 where id = '33333333-0000-4000-8000-000000000001' and version = 1;
  if found then raise exception 'update con versión vieja no debería aplicar'; end if;
end $$;

-- ─── Idempotencia: reinsertar el mismo UUID no duplica ───
insert into public.water_logs (id, log_date, quantity_ml, logged_at) values ('55555555-0000-4000-8000-000000000001', '2026-11-05', 250, now());
insert into public.water_logs (id, log_date, quantity_ml, logged_at) values ('55555555-0000-4000-8000-000000000001', '2026-11-05', 250, now()) on conflict (id) do nothing;
do $$ begin
  if (select count(*) from public.water_logs) <> 1 then raise exception 'insert idempotente duplicó'; end if;
end $$;

-- ─── Usuario B no ve ni toca nada de A ───
select set_config('request.jwt.claim.sub', :B, false);
do $$
begin
  if (select count(*) from public.profiles) <> 0 then raise exception 'B ve perfiles ajenos'; end if;
  if (select count(*) from public.food_logs) <> 0 then raise exception 'B ve comidas ajenas'; end if;
  if (select count(*) from public.training_plans) <> 0 then raise exception 'B ve planes ajenos'; end if;
  update public.food_logs set quantity = 1;
  if found then raise exception 'B modificó comidas ajenas'; end if;
  delete from public.running_sessions;
  if found then raise exception 'B borró carreras ajenas'; end if;
end $$;

-- B no puede insertar datos a nombre de A
do $$ begin
  begin
    insert into public.water_logs (id, user_id, log_date, quantity_ml, logged_at) values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-05', 100, now());
    raise exception 'B insertó a nombre de A';
  exception when insufficient_privilege then null; end;
end $$;

-- B no puede colgar un día de entrenamiento del plan de A adivinando el UUID
do $$ begin
  begin
    insert into public.training_days (id, plan_id, date, day_number, session_type, planned)
      values (gen_random_uuid(), '11111111-0000-4000-8000-000000000001', '2026-11-10', 2, 'rest', '{}');
    raise exception 'B insertó en un plan ajeno';
  exception when insufficient_privilege then null; end;
end $$;

-- B no puede referenciar un día de entrenamiento ajeno desde su carrera
do $$ begin
  begin
    insert into public.running_sessions (id, training_day_id, session_date, source, distance_km, duration_seconds)
      values (gen_random_uuid(), '22222222-0000-4000-8000-000000000001', '2026-11-05', 'manual', 3, 900);
    raise exception 'B referenció un día ajeno';
  exception when insufficient_privilege then null; end;
end $$;

-- Catálogo global de solo lectura
do $$ begin
  update public.exercises set name = 'hack' where id = 'push-up';
  if found then raise exception 'B modificó el catálogo global'; end if;
  begin
    insert into public.exercises (id, name, primary_muscle, pattern, type, difficulty, equipment) values ('fake', 'Fake', 'chest', 'squat', 'strength', 1, '{bodyweight}');
    raise exception 'B insertó en el catálogo global';
  exception when insufficient_privilege then null; end;
end $$;

-- Alimento personalizado: B lo ve, A no
insert into public.food_items (id, owner_id, name, kcal, protein, carbs, fat) values ('custom-barrita-b', :B, 'Barrita B', 400, 20, 50, 13);
select set_config('request.jwt.claim.sub', :A, false);
do $$ begin
  if exists (select 1 from public.food_items where id = 'custom-barrita-b') then raise exception 'A ve alimentos personalizados de B'; end if;
  begin
    insert into public.food_logs (id, food_item_id, log_date, meal_type, quantity, unit, grams, food_name, calories, protein, carbohydrates, fats, logged_at)
      values (gen_random_uuid(), 'custom-barrita-b', '2026-11-05', 'snack', 1, 'g', 50, 'x', 200, 10, 25, 6, now());
    raise exception 'A registró un alimento ajeno';
  exception when insufficient_privilege then null; end;
end $$;

-- ─── Storage: solo la carpeta propia ───
do $$ begin
  insert into storage.objects (bucket_id, name) values ('progress-photos', 'aaaaaaaa-0000-4000-8000-000000000001/foto1.jpg');
  begin
    insert into storage.objects (bucket_id, name) values ('progress-photos', 'bbbbbbbb-0000-4000-8000-000000000002/robada.jpg');
    raise exception 'A subió a la carpeta de B';
  exception when insufficient_privilege then null; end;
  if (select public from storage.buckets where id = 'progress-photos') then raise exception 'bucket público'; end if;
  -- La ruta registrada debe estar en la carpeta del propio usuario
  begin
    insert into public.progress_photos (id, storage_path, photo_date) values (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000002/x.jpg', '2026-11-05');
    raise exception 'A registró una foto con ruta ajena';
  exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub', :B, false);
do $$ begin
  if (select count(*) from storage.objects) <> 0 then raise exception 'B ve fotos de A'; end if;
end $$;

-- ─── Anónimo: nada ───
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if (select count(*) from public.exercises) <> 0 then raise exception 'anon ve el catálogo'; end if;
  if (select count(*) from public.profiles) <> 0 then raise exception 'anon ve perfiles'; end if;
end $$;

-- ─── Eliminación de cuenta: borra todo en cascada ───
reset role;
delete from auth.users where id = :A;
do $$ begin
  if exists (select 1 from public.food_logs) or exists (select 1 from public.training_days) or exists (select 1 from public.profiles) then
    raise exception 'quedaron datos tras eliminar la cuenta';
  end if;
end $$;

-- ─── Todas las tablas públicas tienen RLS ───
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    raise exception 'tabla sin RLS: %', t;
  end loop;
end $$;

\echo '✔ RLS, versionado, idempotencia, storage y borrado de cuenta: OK'
