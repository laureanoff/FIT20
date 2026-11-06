-- Salida de cardio en curso: el teléfono informa tiempo, distancia y ritmo; el servidor manda la
-- notificación "en vivo" cada 1, 2 o 5 minutos (llega aunque la app esté congelada con el celu bloqueado).
create table public.live_sessions (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  activity text not null check (activity in ('run', 'walk', 'bike')),
  status text not null check (status in ('running', 'paused')),
  elapsed_s integer not null check (elapsed_s between 0 and 86400),
  updated_at timestamptz not null default now(),
  distance_km numeric(7, 3) not null default 0 check (distance_km between 0 and 1000),
  pace_s_per_km numeric(7, 1) check (pace_s_per_km is null or pace_s_per_km between 30 and 3600),
  target_km numeric(6, 2) check (target_km is null or target_km between 0 and 1000),
  interval_min smallint not null default 2 check (interval_min in (1, 2, 5)),
  next_push_at timestamptz
);
create index live_sessions_next_idx on public.live_sessions (next_push_at) where next_push_at is not null;

alter table public.live_sessions enable row level security;
create policy "live_sessions: ver la propia" on public.live_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy "live_sessions: crear la propia" on public.live_sessions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "live_sessions: editar la propia" on public.live_sessions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "live_sessions: borrar la propia" on public.live_sessions for delete to authenticated using (user_id = (select auth.uid()));

-- Cada minuto, solo si hay alguna notificación pendiente (sin salidas en curso no se llama a la función).
select cron.schedule(
  'fit20-live-sessions',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://krlhvdrrjqioohucqmfz.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fit20_cron_secret')
    ),
    body := '{"mode":"live"}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (select 1 from public.live_sessions where next_push_at <= now());
  $$
);
