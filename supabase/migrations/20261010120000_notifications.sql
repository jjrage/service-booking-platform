-- Notifications through an outbox. Messages are queued by a trigger on booking_events, in the same transaction
-- as the change that caused them: a booking can never be confirmed without its confirmation being queued, and
-- a message is never queued for a change that rolled back. A sender job claims due messages and delivers them
-- once: each has a unique dedupe key, and delivery uses it as the provider's idempotency key.

create type public.outbox_status as enum ('pending', 'sending', 'sent', 'failed', 'cancelled');
create type public.outbox_channel as enum ('email', 'sms_log');

create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in (
    'booking_confirmed', 'booking_rescheduled', 'booking_cancelled', 'reminder_72h', 'reminder_24h',
    'review_request', 'no_access', 'payment_failed'
  )),
  channel public.outbox_channel not null default 'email',
  to_address text not null,
  booking_id uuid,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  dedupe_key text not null unique,
  send_after timestamptz not null default now(),
  status public.outbox_status not null default 'pending',
  attempts integer not null default 0,
  claimed_at timestamptz,
  last_error text,
  sent_at timestamptz,
  provider text,
  provider_message_id text,
  -- What was actually sent, kept for the admin console (most demo addresses are fictional).
  subject text,
  body_html text,
  body_text text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create index outbox_due_idx on public.outbox (send_after) where status in ('pending', 'sending');
create index outbox_booking_idx on public.outbox (booking_id);
create index outbox_tenant_idx on public.outbox (tenant_id, created_at desc);

alter table public.outbox enable row level security;
grant select on public.outbox to authenticated;
create policy outbox_staff_read on public.outbox
  for select to authenticated using (private.is_staff(tenant_id));

-- Queueing ----------------------------------------------------------------------------------------------

create function private.enqueue(
  p_tenant_id uuid,
  p_kind text,
  p_channel public.outbox_channel,
  p_to text,
  p_booking_id uuid,
  p_dedupe_key text,
  p_send_after timestamptz,
  p_payload jsonb default '{}'
) returns void
language sql set search_path = '' as $$
  insert into public.outbox (tenant_id, kind, channel, to_address, booking_id, dedupe_key, send_after, payload)
  select p_tenant_id, p_kind, p_channel, p_to, p_booking_id, p_dedupe_key, p_send_after, p_payload
  where p_to is not null and btrim(p_to) <> ''
  on conflict (dedupe_key) do nothing;
$$;

-- Reminders 72 and 24 hours before the arrival window; the keys include the window, so a rescheduled visit
-- gets new reminders while the old ones are cancelled. A reminder whose time has already passed is skipped.
create function private.enqueue_reminders(p_booking_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
  v_client public.clients;
  v_start timestamptz;
  v_epoch bigint;
begin
  select * into v_booking from public.bookings b where b.id = p_booking_id;
  if v_booking.status <> 'confirmed' then
    return;
  end if;
  select * into v_client from public.clients c where c.id = v_booking.client_id;
  v_start := lower(v_booking.arrival_window);
  v_epoch := extract(epoch from v_start)::bigint;

  if v_start - interval '72 hours' > now() then
    perform private.enqueue(v_booking.tenant_id, 'reminder_72h', 'email', v_client.email, v_booking.id,
      format('%s:reminder_72h:%s', v_booking.id, v_epoch), v_start - interval '72 hours');
  end if;
  if v_start - interval '24 hours' > now() then
    perform private.enqueue(v_booking.tenant_id, 'reminder_24h', 'email', v_client.email, v_booking.id,
      format('%s:reminder_24h:%s', v_booking.id, v_epoch), v_start - interval '24 hours');
    -- SMS stays a log entry: US carrier registration (10DLC) is out of scope for a demo.
    perform private.enqueue(v_booking.tenant_id, 'reminder_24h', 'sms_log', v_client.phone, v_booking.id,
      format('%s:reminder_24h_sms:%s', v_booking.id, v_epoch), v_start - interval '24 hours');
  end if;
end;
$$;

create function private.notify_on_booking_event() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
  v_email text;
  v_epoch bigint;
begin
  -- History written by the demo seed is not news: only react to events that just happened.
  if new.created_at < now() - interval '10 minutes' then
    return null;
  end if;

  select * into v_booking from public.bookings b where b.id = new.booking_id;
  select c.email into v_email from public.clients c where c.id = v_booking.client_id;
  v_epoch := extract(epoch from lower(v_booking.arrival_window))::bigint;

  if new.event in ('rescheduled', 'cancelled', 'expired', 'no_access') then
    update public.outbox o
    set status = 'cancelled'
    where o.booking_id = new.booking_id
      and o.status = 'pending'
      and o.kind in ('reminder_72h', 'reminder_24h');
  end if;

  if new.event = 'confirmed' or (new.event = 'created' and new.to_status = 'confirmed') then
    -- Regular visits are announced by their reminders, not by one confirmation each.
    if v_booking.source <> 'plan' then
      perform private.enqueue(new.tenant_id, 'booking_confirmed', 'email', v_email, new.booking_id,
        format('%s:confirmed', new.booking_id), now());
    end if;
    perform private.enqueue_reminders(new.booking_id);
  elsif new.event = 'rescheduled' then
    perform private.enqueue(new.tenant_id, 'booking_rescheduled', 'email', v_email, new.booking_id,
      format('%s:rescheduled:%s', new.booking_id, v_epoch), now(), new.data);
    perform private.enqueue_reminders(new.booking_id);
  elsif new.event = 'cancelled' then
    perform private.enqueue(new.tenant_id, 'booking_cancelled', 'email', v_email, new.booking_id,
      format('%s:cancelled', new.booking_id), now(), new.data);
  elsif new.event = 'completed' then
    perform private.enqueue(new.tenant_id, 'review_request', 'email', v_email, new.booking_id,
      format('%s:review', new.booking_id), now() + interval '2 hours');
  elsif new.event = 'no_access' then
    perform private.enqueue(new.tenant_id, 'no_access', 'email', v_email, new.booking_id,
      format('%s:no_access', new.booking_id), now(), new.data);
  elsif new.event = 'payment_failed'
    and new.data ->> 'purpose' in ('balance', 'cancellation_fee', 'no_access_fee') then
    perform private.enqueue(new.tenant_id, 'payment_failed', 'email', v_email, new.booking_id,
      format('%s:payment_failed:%s', new.booking_id, new.data ->> 'payment_id'), now(), new.data);
  end if;
  return null;
end;
$$;

create trigger booking_events_notify
  after insert on public.booking_events
  for each row execute function private.notify_on_booking_event();

-- Commands ------------------------------------------------------------------------------------------------

-- Queues reminders for a business's upcoming visits (used after importing history; safe to repeat).
create function public.cmd_schedule_reminders(p_tenant_id uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select b.id from public.bookings b
    where b.tenant_id = p_tenant_id and b.status = 'confirmed' and lower(b.arrival_window) > now()
  loop
    perform private.enqueue_reminders(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Claims up to p_limit due messages for sending. SKIP LOCKED lets several senders run at once without taking
-- the same message; a message stuck in 'sending' (a sender crashed) is claimed again after 10 minutes.
create function public.cmd_claim_outbox(p_limit integer default 20) returns setof public.outbox
language sql set search_path = '' as $$
  with due as (
    select o.id
    from public.outbox o
    where (o.status = 'pending' and o.send_after <= now())
       or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes')
    order by o.send_after
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  update public.outbox o
  set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
  from due
  where o.id = due.id
  returning o.*;
$$;

-- Records the outcome of one delivery. A failure is retried with growing delays, up to 5 attempts.
create function public.cmd_finish_outbox(
  p_id uuid,
  p_ok boolean,
  p_provider text,
  p_provider_message_id text,
  p_error text,
  p_subject text,
  p_body_html text,
  p_body_text text
) returns public.outbox_status
language plpgsql set search_path = '' as $$
declare
  v_row public.outbox;
begin
  select * into v_row from public.outbox o where o.id = p_id for update;
  if not found or v_row.status <> 'sending' then
    return v_row.status;
  end if;

  update public.outbox o
  set status = case when p_ok then 'sent'::public.outbox_status
                    when o.attempts >= 5 then 'failed'::public.outbox_status
                    else 'pending'::public.outbox_status end,
      sent_at = case when p_ok then now() end,
      send_after = case when p_ok then o.send_after else now() + make_interval(mins => power(2, o.attempts)::int) end,
      provider = p_provider,
      provider_message_id = p_provider_message_id,
      last_error = case when p_ok then null else left(p_error, 1000) end,
      subject = coalesce(p_subject, o.subject),
      body_html = coalesce(p_body_html, o.body_html),
      body_text = coalesce(p_body_text, o.body_text)
  where o.id = p_id
  returning o.* into v_row;
  return v_row.status;
end;
$$;

revoke all on function
  public.cmd_schedule_reminders(uuid),
  public.cmd_claim_outbox(integer),
  public.cmd_finish_outbox(uuid, boolean, text, text, text, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.cmd_schedule_reminders(uuid),
  public.cmd_claim_outbox(integer),
  public.cmd_finish_outbox(uuid, boolean, text, text, text, text, text, text)
to service_role;

grant execute on function
  private.enqueue(uuid, text, public.outbox_channel, text, uuid, text, timestamptz, jsonb),
  private.enqueue_reminders(uuid)
to service_role;
