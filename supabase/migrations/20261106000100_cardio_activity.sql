-- FIT 20 · 006 · Caminata y bici en el mismo registro que el running
-- Las salidas existentes quedan como running (valor por defecto).

alter table public.running_sessions
  add column activity text not null default 'run' check (activity in ('run', 'walk', 'bike'));

create index running_sessions_user_activity_idx on public.running_sessions (user_id, activity, session_date);
