-- ═══════════════════════════════════════════════════════════════════
-- FIT 20 · 001 · Esquema principal
-- Convenciones para sincronización offline-first:
--   · id uuid generado en el dispositivo (idempotencia: reenviar no duplica)
--   · version int: la incrementa el servidor en cada UPDATE (control optimista)
--   · updated_at: lo fija el servidor (cursor para descargar cambios)
--   · deleted_at: borrado lógico; nada se pierde sin confirmación
--   · user_id = auth.uid() por defecto; RLS en todas las tablas privadas
-- ═══════════════════════════════════════════════════════════════════

-- ───────── Funciones de soporte ─────────

create or replace function public.fit20_sync_meta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
  else
    new.version := old.version + 1;
    new.created_at := old.created_at;
    new.updated_at := now();
    if new.deleted_at is not null and old.deleted_at is not null then
      new.deleted_at := old.deleted_at; -- un borrado no se "re-borra"
    end if;
  end if;
  return new;
end;
$$;

-- Aplica columnas de sync + trigger a una tabla.
create or replace function public.fit20_enable_sync(tbl regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('create trigger sync_meta before insert or update on %s for each row execute function public.fit20_sync_meta()', tbl);
end;
$$;

-- ───────── Perfil y configuración ─────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 80),
  birth_date date check (birth_date between '1900-01-01' and current_date),
  sex text check (sex in ('female', 'male')),
  height_cm numeric(5,1) check (height_cm between 100 and 250),
  current_weight_kg numeric(5,2) check (current_weight_kg between 25 and 350),
  target_weight_kg numeric(5,2) check (target_weight_kg between 25 and 350),
  fitness_level text not null default 'beginner' check (fitness_level in ('beginner', 'intermediate', 'advanced')),
  running_experience text not null default 'none' check (running_experience in ('none', 'occasional', 'regular', 'experienced')),
  max_run_distance_km numeric(5,2) not null default 0 check (max_run_distance_km between 0 and 100),
  training_weekdays smallint[] not null default '{}',
  session_minutes smallint not null default 45 check (session_minutes between 15 and 180),
  equipment text[] not null default '{}',
  dietary_preferences text[] not null default '{}',
  dietary_restrictions text[] not null default '{}',
  injuries text[] not null default '{}',
  primary_goal text not null default 'fitness' check (primary_goal in ('lose_fat', 'lose_weight', 'gain_muscle', 'endurance', 'fitness', 'maintain', 'recomposition')),
  onboarding_completed boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (training_weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
);

create table public.user_settings (
  id uuid primary key,
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  units text not null default 'metric' check (units in ('metric', 'imperial')),
  notifications_enabled boolean not null default false,
  sound_enabled boolean not null default true,
  vibration_enabled boolean not null default true,
  default_rest_seconds smallint not null default 60 check (default_rest_seconds between 10 and 600),
  reminders jsonb not null default '[]'::jsonb,
  offline_enabled boolean not null default true,
  nutrition_targets jsonb, -- objetivos ajustados manualmente
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ───────── Catálogos (globales + personalizados) ─────────

create table public.exercises (
  id text primary key check (id ~ '^[a-z0-9-]{2,80}$'),
  owner_id uuid references auth.users (id) on delete cascade, -- null = catálogo global
  name text not null check (char_length(name) between 2 and 80),
  primary_muscle text not null,
  secondary_muscles text[] not null default '{}',
  pattern text not null,
  type text not null,
  difficulty smallint not null check (difficulty between 1 and 3),
  equipment text[] not null check (cardinality(equipment) > 0),
  description text not null default '',
  steps text[] not null default '{}',
  common_mistakes text[] not null default '{}',
  safety text[] not null default '{}',
  easier text[] not null default '{}',
  harder text[] not null default '{}',
  stress_regions text[] not null default '{}',
  timed boolean not null default false,
  unilateral boolean not null default false,
  image_url text,
  video_url text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.food_items (
  id text primary key check (id ~ '^[a-z0-9-]{2,80}$'),
  owner_id uuid references auth.users (id) on delete cascade, -- null = base global
  name text not null check (char_length(name) between 2 and 80),
  brand text,
  category text not null default 'Personalizados',
  state text not null default 'na' check (state in ('raw', 'cooked', 'na')),
  kcal numeric(6,1) not null check (kcal between 0 and 900),
  protein numeric(5,1) not null check (protein between 0 and 100),
  carbs numeric(5,1) not null check (carbs between 0 and 100),
  fat numeric(5,1) not null check (fat between 0 and 100),
  portions jsonb not null default '{}'::jsonb,
  is_liquid boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (protein + carbs + fat <= 100.5)
);

create table public.exercise_favorites (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id text not null references public.exercises (id) on delete cascade,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, exercise_id)
);

-- ───────── Planificación ─────────

create table public.training_plans (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  goal text not null,
  input jsonb not null, -- parámetros del generador (reproducible: el motor es determinístico)
  duration_days smallint not null check (duration_days between 1 and 365),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  paused_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (end_date >= start_date)
);

create table public.training_days (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id uuid not null references public.training_plans (id) on delete cascade,
  date date not null,
  day_number smallint not null check (day_number >= 1),
  session_type text not null check (session_type in ('strength', 'run', 'strength_run', 'active_recovery', 'rest')),
  status text not null default 'pending' check (status in ('pending', 'started', 'completed', 'skipped')),
  planned jsonb not null, -- PlannedDay: ejercicios, series, carrera, instrucciones
  readiness jsonb, -- reporte de fatiga/dolor y ajustes aplicados
  notes text check (char_length(notes) <= 2000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (plan_id, day_number)
);

-- ───────── Entrenamientos realizados ─────────

create table public.workouts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  training_day_id uuid references public.training_days (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  category text not null default 'strength',
  estimated_duration_min smallint,
  status text not null default 'started' check (status in ('started', 'completed', 'abandoned')),
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  rpe smallint check (rpe between 1 and 10),
  notes text check (char_length(notes) <= 2000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (completed_at is null or completed_at >= started_at)
);

create table public.workout_exercises (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_id text not null references public.exercises (id),
  order_index smallint not null check (order_index >= 0),
  sets smallint not null check (sets between 1 and 20),
  repetitions text not null,
  rest_seconds smallint not null check (rest_seconds between 0 and 900),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.exercise_sets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  set_number smallint not null check (set_number between 1 and 20),
  repetitions_completed smallint check (repetitions_completed between 0 and 500),
  duration_seconds smallint check (duration_seconds between 0 and 3600),
  weight_kg numeric(6,2) check (weight_kg between 0 and 500),
  completed_at timestamptz not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workout_exercise_id, set_number)
);

-- ───────── Running ─────────

create table public.running_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  training_day_id uuid references public.training_days (id) on delete set null,
  session_date date not null,
  started_at timestamptz,
  run_type text,
  source text not null check (source in ('gps', 'manual')),
  distance_km numeric(6,3) not null check (distance_km > 0 and distance_km <= 300),
  duration_seconds integer not null check (duration_seconds > 0 and duration_seconds <= 172800),
  average_pace_s numeric(7,1) generated always as (duration_seconds / distance_km) stored,
  target_distance_km numeric(6,3),
  target_duration_seconds integer,
  rpe smallint check (rpe between 1 and 10),
  notes text check (char_length(notes) <= 2000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.running_splits (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null references public.running_sessions (id) on delete cascade,
  kilometer smallint not null check (kilometer >= 1),
  duration_seconds integer not null check (duration_seconds > 0),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (session_id, kilometer)
);

-- Un recorrido GPS por sesión (en lugar de una fila por punto: ~700 puntos/hora
-- serían 700 operaciones de sincronización). points = [[lat, lng, elapsed_ms, accuracy, segment], …]
create table public.running_tracks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null unique references public.running_sessions (id) on delete cascade,
  points jsonb not null check (jsonb_typeof(points) = 'array'),
  point_count integer generated always as (jsonb_array_length(points)) stored,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (jsonb_array_length(points) <= 50000)
);

-- ───────── Nutrición ─────────

create table public.food_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  food_item_id text not null references public.food_items (id),
  log_date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'snack', 'dinner', 'extra', 'drink')),
  quantity numeric(8,2) not null check (quantity > 0),
  unit text not null,
  grams numeric(8,1) not null check (grams > 0 and grams <= 5000),
  -- Snapshot de los valores al registrar: si el alimento cambia después, el historial no se altera.
  food_name text not null,
  calories numeric(7,1) not null check (calories >= 0),
  protein numeric(6,1) not null check (protein >= 0),
  carbohydrates numeric(6,1) not null check (carbohydrates >= 0),
  fats numeric(6,1) not null check (fats >= 0),
  logged_at timestamptz not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.saved_meals (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 40),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.water_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  quantity_ml integer not null check (quantity_ml between 1 and 5000),
  logged_at timestamptz not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ───────── Progreso físico ─────────

create table public.body_measurements (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_on date not null,
  weight_kg numeric(5,2) check (weight_kg between 25 and 350),
  waist_cm numeric(5,1) check (waist_cm between 30 and 250),
  hip_cm numeric(5,1) check (hip_cm between 30 and 250),
  chest_cm numeric(5,1) check (chest_cm between 30 and 250),
  arm_cm numeric(5,1) check (arm_cm between 10 and 100),
  thigh_cm numeric(5,1) check (thigh_cm between 20 and 150),
  notes text check (char_length(notes) <= 2000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (num_nonnulls(weight_kg, waist_cm, hip_cm, chest_cm, arm_cm, thigh_cm) > 0)
);

create table public.progress_photos (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null unique,
  photo_date date not null,
  pose text check (pose in ('front', 'side', 'back', 'other')),
  notes text check (char_length(notes) <= 1000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- La foto debe vivir dentro de la carpeta del propio usuario en el bucket privado.
  check (storage_path like user_id::text || '/%')
);

-- ───────── Triggers de sincronización ─────────

select public.fit20_enable_sync(t::regclass) from unnest(array[
  'public.profiles', 'public.user_settings', 'public.exercises', 'public.food_items', 'public.exercise_favorites',
  'public.training_plans', 'public.training_days', 'public.workouts', 'public.workout_exercises', 'public.exercise_sets',
  'public.running_sessions', 'public.running_splits', 'public.running_tracks',
  'public.food_logs', 'public.saved_meals', 'public.water_logs', 'public.body_measurements', 'public.progress_photos'
]) as t;

-- ───────── Índices ─────────
-- (user_id, updated_at): descarga incremental de cambios por usuario.

create index profiles_updated_idx on public.profiles (updated_at);
create index exercises_owner_idx on public.exercises (owner_id, updated_at);
create index food_items_owner_idx on public.food_items (owner_id, updated_at);
create index exercise_favorites_user_idx on public.exercise_favorites (user_id, updated_at);
create index training_plans_user_idx on public.training_plans (user_id, updated_at);
create index training_plans_active_idx on public.training_plans (user_id) where status = 'active' and deleted_at is null;
create index training_days_user_idx on public.training_days (user_id, updated_at);
create index training_days_plan_date_idx on public.training_days (plan_id, date);
create index workouts_user_idx on public.workouts (user_id, updated_at);
create index workouts_day_idx on public.workouts (training_day_id);
create index workout_exercises_user_idx on public.workout_exercises (user_id, updated_at);
create index workout_exercises_workout_idx on public.workout_exercises (workout_id);
create index workout_exercises_exercise_idx on public.workout_exercises (exercise_id);
create index exercise_sets_user_idx on public.exercise_sets (user_id, updated_at);
create index running_sessions_user_idx on public.running_sessions (user_id, updated_at);
create index running_sessions_date_idx on public.running_sessions (user_id, session_date);
create index running_sessions_day_idx on public.running_sessions (training_day_id);
create index running_splits_user_idx on public.running_splits (user_id, updated_at);
create index running_tracks_user_idx on public.running_tracks (user_id, updated_at);
create index food_logs_user_idx on public.food_logs (user_id, updated_at);
create index food_logs_date_idx on public.food_logs (user_id, log_date);
create index food_logs_food_idx on public.food_logs (food_item_id);
create index saved_meals_user_idx on public.saved_meals (user_id, updated_at);
create index water_logs_user_idx on public.water_logs (user_id, updated_at);
create index water_logs_date_idx on public.water_logs (user_id, log_date);
create index body_measurements_user_idx on public.body_measurements (user_id, updated_at);
create index body_measurements_date_idx on public.body_measurements (user_id, measured_on);
create index progress_photos_user_idx on public.progress_photos (user_id, updated_at);
