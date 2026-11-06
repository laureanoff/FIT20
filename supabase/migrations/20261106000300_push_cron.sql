-- Ejecuta la función de avisos cada 15 minutos. El secreto se lee de Vault en cada corrida.
-- (Requiere los secretos fit20_cron_secret / fit20_vapid_* en Vault: ver SETUP.md.)
select cron.schedule(
  'fit20-send-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://krlhvdrrjqioohucqmfz.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fit20_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
