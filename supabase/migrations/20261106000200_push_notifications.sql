-- Notificaciones push: suscripciones por dispositivo, preferencias por usuario y aviso programado cada 15 min.
-- Las claves (VAPID privada y secreto del cron) viven en Supabase Vault, nunca en el repo ni en el frontend.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ───────── Suscripciones (una por navegador/dispositivo) ─────────
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  device text check (char_length(device) <= 120),
  failures smallint not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions: ver las propias" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "push_subscriptions: borrar las propias" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
-- El alta pasa por register_push_subscription(): un mismo navegador puede cambiar de cuenta.

create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  -- El endpoint identifica al navegador: si estaba asociado a otra cuenta, pasa a esta.
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> v_uid;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_device, 120))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, failures = 0
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- ───────── Preferencias ─────────
create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  morning_enabled boolean not null default true,
  morning_time time not null default '07:30',
  evening_enabled boolean not null default false,
  evening_time time not null default '20:00',
  include_weather boolean not null default true,
  timezone text not null default 'America/Argentina/Buenos_Aires' check (char_length(timezone) between 3 and 64),
  -- Ubicación aproximada (2 decimales ≈ 1 km) solo para el pronóstico.
  lat numeric(5, 2) check (lat between -90 and 90),
  lon numeric(5, 2) check (lon between -180 and 180),
  last_morning_date date,
  last_evening_date date,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
create policy "notification_prefs: ver las propias" on public.notification_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy "notification_prefs: crear las propias" on public.notification_prefs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notification_prefs: editar las propias" on public.notification_prefs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────── Configuración privada para la función (solo service_role) ─────────
create or replace function public.push_config()
returns table (vapid_public text, vapid_private text, cron_secret text)
language sql
security definer
set search_path = ''
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'fit20_vapid_public'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'fit20_vapid_private'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'fit20_cron_secret');
$$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;
