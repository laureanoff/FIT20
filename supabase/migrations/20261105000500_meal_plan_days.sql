-- FIT 20 · 005 · Plan de alimentación por día
-- Un registro por usuario y fecha (id estable derivado de usuario+fecha en el cliente: dos
-- dispositivos que generan el mismo día editan el MISMO registro). meals = [{meal_type, template_id,
-- title, items: [{food_item_id, quantity, unit, grams}], logged}, …]

create table public.meal_plan_days (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_date date not null,
  meals jsonb not null check (jsonb_typeof(meals) = 'array' and jsonb_array_length(meals) between 1 and 8),
  targets jsonb not null default '{}'::jsonb check (jsonb_typeof(targets) = 'object'),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, plan_date)
);

select public.fit20_enable_sync('public.meal_plan_days'::regclass);
create index meal_plan_days_user_idx on public.meal_plan_days (user_id, updated_at);

alter table public.meal_plan_days enable row level security;
create policy meal_plan_days_select on public.meal_plan_days for select to authenticated using (user_id = (select auth.uid()));
create policy meal_plan_days_insert on public.meal_plan_days for insert to authenticated with check (user_id = (select auth.uid()));
create policy meal_plan_days_update on public.meal_plan_days for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy meal_plan_days_delete on public.meal_plan_days for delete to authenticated using (user_id = (select auth.uid()));
