-- Último pronóstico que bajó el teléfono (48 h): respaldo si Open-Meteo no responde a la función.
alter table public.notification_prefs
  add column forecast jsonb check (forecast is null or pg_column_size(forecast) < 60000),
  add column forecast_at timestamptz;
