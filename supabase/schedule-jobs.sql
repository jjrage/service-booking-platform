-- Scheduled jobs for a deployed Supabase project (run once in the SQL editor; not a migration, because the
-- app URL and the secret differ per environment).
--
-- pg_cron calls the app's jobs endpoint through pg_net every minute; the shared secret is kept in Vault.
-- Replace the two placeholders, then run the whole file. Vercel cron calls /api/jobs/plans once a day
-- (see vercel.json), so plans are not scheduled here.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-APP.vercel.app', 'app_url');
select vault.create_secret('YOUR-CRON-SECRET', 'cron_secret');

select cron.schedule(
  'booking-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/jobs/tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 20000
  );
  $$
);

-- To stop it: select cron.unschedule('booking-tick');
