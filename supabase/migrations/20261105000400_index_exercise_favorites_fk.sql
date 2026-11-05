-- FIT 20 · 004 · Índice para la FK exercise_favorites.exercise_id (aviso del linter de rendimiento de Supabase)
create index if not exists exercise_favorites_exercise_idx on public.exercise_favorites (exercise_id);
