-- Payments: saved cards, payments, refunds, and the provider events already processed.
--
-- The payment provider (Stripe in test mode, or the built-in simulator when no Stripe keys are configured)
-- owns card data; the database only keeps references and the brand and last four digits for display.
-- Provider events (webhooks) are applied through cmd_apply_payment_event, which records each event id first:
-- a redelivered event changes nothing.

alter type public.booking_event_type add value 'payment_received';
alter type public.booking_event_type add value 'refund_issued';
alter type public.booking_event_type add value 'fee_charged';

create type public.payment_provider as enum ('stripe', 'simulated');
create type public.payment_purpose as enum (
  'deposit',          -- one-time visit: part of the price, charged when booking
  'card_setup',       -- plan visit: save the card now, charge after each visit
  'balance',          -- the rest of the price after the visit, off-session
  'cancellation_fee', -- late cancellation or reschedule, off-session
  'no_access_fee'     -- the crew could not get in, off-session
);
create type public.payment_status as enum (
  'requires_payment', 'requires_action', 'processing', 'succeeded', 'failed', 'canceled'
);
create type public.refund_status as enum ('pending', 'succeeded', 'failed');

-- The client's customer record and default card at the provider. Kept out of public.clients because a
-- cleaner may read a client's row (contact details) but has no business seeing billing data.
create table public.client_billing (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid not null,
  provider public.payment_provider not null,
  customer_ref text not null,
  payment_method_ref text,
  card_brand text,
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  card_exp_month smallint check (card_exp_month between 1 and 12),
  card_exp_year smallint check (card_exp_year between 2000 and 2100),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, client_id),
  unique (provider, customer_ref),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade
);

create trigger client_billing_touch_updated_at
  before update on public.client_billing
  for each row execute function private.touch_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  booking_id uuid not null,
  client_id uuid not null,
  purpose public.payment_purpose not null,
  amount_cents bigint not null check (amount_cents >= 0),
  currency char(3) not null default 'USD',
  provider public.payment_provider not null,
  -- PaymentIntent or SetupIntent id at the provider.
  provider_payment_id text not null,
  status public.payment_status not null default 'requires_payment',
  off_session boolean not null default false,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  succeeded_at timestamptz,
  unique (tenant_id, id),
  unique (provider, provider_payment_id),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade,
  check ((purpose = 'card_setup') = (amount_cents = 0)),
  check ((status = 'succeeded') = (succeeded_at is not null))
);

create index payments_booking_idx on public.payments (tenant_id, booking_id);
create index payments_client_idx on public.payments (tenant_id, client_id);

create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function private.touch_updated_at();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  payment_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  status public.refund_status not null default 'pending',
  provider_refund_id text unique,
  reason text,
  -- Plain uuid: who issued it (staff) or null for automatic refunds.
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, payment_id) references public.payments (tenant_id, id) on delete cascade
);

create index refunds_payment_idx on public.refunds (payment_id);

create trigger refunds_touch_updated_at
  before update on public.refunds
  for each row execute function private.touch_updated_at();

-- Every provider event applied, by id. A webhook that arrives twice finds its id here and does nothing.
create table public.payment_events (
  provider public.payment_provider not null,
  event_id text not null,
  type text not null,
  payment_ref text,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create trigger payment_events_append_only
  before update on public.payment_events
  for each row execute function private.reject_update();

revoke update, delete, truncate on public.payment_events from service_role;

-- Read access -----------------------------------------------------------------------------------------

alter table public.client_billing enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.payment_events enable row level security;

grant select on public.client_billing, public.payments, public.refunds to authenticated;

create policy client_billing_staff_read on public.client_billing
  for select to authenticated using (private.is_staff(tenant_id));
create policy client_billing_owner_read on public.client_billing
  for select to authenticated using (client_id in (select private.my_client_ids()));

create policy payments_staff_read on public.payments
  for select to authenticated using (private.is_staff(tenant_id));
create policy payments_owner_read on public.payments
  for select to authenticated using (client_id in (select private.my_client_ids()));

create policy refunds_staff_read on public.refunds
  for select to authenticated using (private.is_staff(tenant_id));
create policy refunds_owner_read on public.refunds
  for select to authenticated
  using (payment_id in (
    select p.id from public.payments p where p.client_id in (select private.my_client_ids())
  ));

-- Commands --------------------------------------------------------------------------------------------

-- Saves the client's customer reference and, when given, their default card.
--   p_card: {"payment_method_ref", "brand", "last4", "exp_month", "exp_year"} or null
create function public.cmd_save_billing(
  p_tenant_id uuid,
  p_client_id uuid,
  p_provider public.payment_provider,
  p_customer_ref text,
  p_card jsonb default null
) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.tenant_id = p_tenant_id) then
    raise exception 'unknown client' using errcode = 'no_data_found';
  end if;

  insert into public.client_billing as cb (
    tenant_id, client_id, provider, customer_ref,
    payment_method_ref, card_brand, card_last4, card_exp_month, card_exp_year
  )
  values (
    p_tenant_id, p_client_id, p_provider, p_customer_ref,
    p_card ->> 'payment_method_ref', p_card ->> 'brand', p_card ->> 'last4',
    (p_card ->> 'exp_month')::smallint, (p_card ->> 'exp_year')::smallint
  )
  on conflict (tenant_id, client_id) do update
  set provider = excluded.provider,
      customer_ref = excluded.customer_ref,
      payment_method_ref = coalesce(excluded.payment_method_ref, cb.payment_method_ref),
      card_brand = coalesce(excluded.card_brand, cb.card_brand),
      card_last4 = coalesce(excluded.card_last4, cb.card_last4),
      card_exp_month = coalesce(excluded.card_exp_month, cb.card_exp_month),
      card_exp_year = coalesce(excluded.card_exp_year, cb.card_exp_year);
end;
$$;

-- Records a payment created at the provider. Deposits and card setups belong to bookings that are still
-- waiting for payment; balances and fees to bookings that exist (any status).
create function public.cmd_start_payment(
  p_booking_id uuid,
  p_purpose public.payment_purpose,
  p_amount_cents bigint,
  p_provider public.payment_provider,
  p_provider_payment_id text,
  p_off_session boolean default false
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
  v_id uuid;
begin
  select * into v_booking from public.bookings b where b.id = p_booking_id;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;
  if p_purpose in ('deposit', 'card_setup') and v_booking.status <> 'pending_payment' then
    raise exception 'a % booking does not take a %', v_booking.status, p_purpose using errcode = 'BK002';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 or p_amount_cents > v_booking.total_cents then
    raise exception 'amount must be between zero and the booking total' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.payments (
    tenant_id, booking_id, client_id, purpose, amount_cents, currency, provider, provider_payment_id,
    off_session
  )
  values (
    v_booking.tenant_id, v_booking.id, v_booking.client_id, p_purpose, p_amount_cents, v_booking.currency,
    p_provider, p_provider_payment_id, coalesce(p_off_session, false)
  )
  on conflict (provider, provider_payment_id) do nothing
  returning id into v_id;

  if v_id is null then
    select p.id into v_id
    from public.payments p
    where p.provider = p_provider and p.provider_payment_id = p_provider_payment_id;
  end if;
  return v_id;
end;
$$;

-- Applies one provider event (a webhook, or the synchronous result of an off-session charge) exactly once.
--
-- 1. An event for a payment this app never recorded (another app on the same provider account) is ignored
--    and not recorded. The server records every payment before the client or an off-session charge can
--    complete it, so a real event always finds its payment.
-- 2. The event id is recorded; a duplicate returns applied = false and changes nothing.
-- 3. The payment's status follows the event, except that a succeeded or canceled payment never goes back.
-- 4. A succeeded deposit or card setup confirms the booking that was waiting for it. A payment that arrives
--    after its booking expired is flagged for the dispatcher to refund or rebook.
--   p_card: the card used, saved as the client's default when the payment succeeds (see cmd_save_billing)
create function public.cmd_apply_payment_event(
  p_provider public.payment_provider,
  p_event_id text,
  p_event_type text,
  p_provider_payment_id text,
  p_status public.payment_status,
  p_failure_code text default null,
  p_failure_message text default null,
  p_card jsonb default null
) returns table (
  applied boolean,
  payment_id uuid,
  booking_id uuid,
  purpose public.payment_purpose,
  payment_status public.payment_status,
  booking_status public.booking_status
)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_payment public.payments;
  v_booking public.bookings;
  v_booking_id uuid;
  v_new_status public.payment_status;
begin
  select p.booking_id into v_booking_id
  from public.payments p
  where p.provider = p_provider and p.provider_payment_id = p_provider_payment_id;

  if not found then
    return query select false, null::uuid, null::uuid, null::public.payment_purpose,
      null::public.payment_status, null::public.booking_status;
    return;
  end if;

  insert into public.payment_events (provider, event_id, type, payment_ref)
  values (p_provider, p_event_id, p_event_type, p_provider_payment_id)
  on conflict do nothing;

  if not found then
    return query
    select false, p.id, p.booking_id, p.purpose, p.status, b.status
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where p.provider = p_provider and p.provider_payment_id = p_provider_payment_id;
    return;
  end if;

  -- Lock order: booking, then payment (as in every command that touches a booking).
  select * into v_booking from public.bookings b where b.id = v_booking_id for update;

  select * into v_payment
  from public.payments p
  where p.provider = p_provider and p.provider_payment_id = p_provider_payment_id
  for update;

  v_new_status := case
    when v_payment.status in ('succeeded', 'canceled') then v_payment.status
    else p_status
  end;

  update public.payments p
  set status = v_new_status,
      failure_code = case when v_new_status in ('failed', 'requires_action') then p_failure_code end,
      failure_message = case when v_new_status in ('failed', 'requires_action') then p_failure_message end,
      succeeded_at = case when v_new_status = 'succeeded' then coalesce(p.succeeded_at, now()) end
  where p.id = v_payment.id;

  if v_new_status = 'succeeded' and v_payment.status <> 'succeeded' then
    if p_card is not null then
      update public.client_billing cb
      set payment_method_ref = coalesce(p_card ->> 'payment_method_ref', cb.payment_method_ref),
          card_brand = coalesce(p_card ->> 'brand', cb.card_brand),
          card_last4 = coalesce(p_card ->> 'last4', cb.card_last4),
          card_exp_month = coalesce((p_card ->> 'exp_month')::smallint, cb.card_exp_month),
          card_exp_year = coalesce((p_card ->> 'exp_year')::smallint, cb.card_exp_year)
      where cb.tenant_id = v_payment.tenant_id and cb.client_id = v_payment.client_id;
    end if;

    if v_payment.purpose in ('deposit', 'card_setup') then
      if v_booking.status = 'pending_payment' then
        update public.bookings b
        set status = 'confirmed', confirmed_at = now(), payment_due_by = null
        where b.id = v_booking.id;

        insert into public.booking_events (
          tenant_id, booking_id, event, from_status, to_status, actor_kind, data
        )
        values (
          v_booking.tenant_id, v_booking.id, 'confirmed', 'pending_payment', 'confirmed', 'system',
          jsonb_build_object('payment_id', v_payment.id, 'purpose', v_payment.purpose,
                             'amount_cents', v_payment.amount_cents)
        );
        v_booking.status := 'confirmed';
      elsif v_booking.status in ('expired', 'cancelled') then
        insert into public.dispatch_alerts (tenant_id, kind, booking_id, message)
        values (
          v_booking.tenant_id, 'payment_failed', v_booking.id,
          format('Payment received for booking #%s after it was %s. Refund it or rebook the client.',
                 v_booking.number, v_booking.status)
        );
      end if;
    end if;

    if v_payment.amount_cents > 0 then
      insert into public.booking_events (
        tenant_id, booking_id, event, from_status, to_status, actor_kind, data
      )
      values (
        v_booking.tenant_id, v_booking.id,
        case when v_payment.purpose in ('cancellation_fee', 'no_access_fee')
             then 'fee_charged'::public.booking_event_type
             else 'payment_received'::public.booking_event_type end,
        v_booking.status, v_booking.status, 'system',
        jsonb_build_object('payment_id', v_payment.id, 'purpose', v_payment.purpose,
                           'amount_cents', v_payment.amount_cents)
      );
    end if;
  elsif v_new_status in ('failed', 'requires_action') and v_payment.status <> v_new_status then
    insert into public.booking_events (
      tenant_id, booking_id, event, from_status, to_status, actor_kind, data
    )
    values (
      v_booking.tenant_id, v_booking.id, 'payment_failed', v_booking.status, v_booking.status, 'system',
      jsonb_build_object('payment_id', v_payment.id, 'purpose', v_payment.purpose,
                         'status', v_new_status, 'failure_code', p_failure_code)
    );

    -- An off-session charge that fails needs a person: the client gets an e-mail, the office an alert.
    if v_payment.off_session then
      insert into public.dispatch_alerts (tenant_id, kind, booking_id, message)
      values (
        v_booking.tenant_id, 'payment_failed', v_booking.id,
        format('%s of %s for booking #%s %s (%s).',
               initcap(replace(v_payment.purpose::text, '_', ' ')),
               to_char(v_payment.amount_cents / 100.0, 'FM$999,990.00'),
               v_booking.number,
               case when v_new_status = 'requires_action' then 'needs the client to authenticate'
                    else 'was declined' end,
               coalesce(p_failure_code, 'no code'))
      );
    end if;
  end if;

  return query select true, v_payment.id, v_payment.booking_id, v_payment.purpose, v_new_status,
    v_booking.status;
end;
$$;

-- Records a refund of part or all of a succeeded payment. The total refunded never exceeds the payment:
-- concurrent refunds of the same payment are serialized by its row lock.
create function public.cmd_record_refund(
  p_payment_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_amount_cents bigint,
  p_reason text,
  p_provider_refund_id text,
  p_status public.refund_status
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_payment public.payments;
  v_refunded bigint;
  v_id uuid;
begin
  perform private.check_actor(p_actor, p_actor_kind);

  select * into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'payment not found' using errcode = 'no_data_found';
  end if;
  if p_actor_kind = 'staff' then
    perform private.require_role(p_actor, v_payment.tenant_id, array['owner', 'dispatcher']::public.member_role[]);
  elsif p_actor_kind <> 'system' then
    raise exception 'only staff or the system issue refunds' using errcode = 'insufficient_privilege';
  end if;
  if v_payment.status <> 'succeeded' then
    raise exception 'only a succeeded payment can be refunded' using errcode = 'BK002';
  end if;

  select coalesce(sum(r.amount_cents), 0) into v_refunded
  from public.refunds r
  where r.payment_id = p_payment_id and r.status <> 'failed';

  if p_amount_cents is null or p_amount_cents <= 0 or v_refunded + p_amount_cents > v_payment.amount_cents then
    raise exception 'refund exceeds what is left of the payment (% of % cents already refunded)',
      v_refunded, v_payment.amount_cents using errcode = 'invalid_parameter_value';
  end if;

  insert into public.refunds (tenant_id, payment_id, amount_cents, status, provider_refund_id, reason, created_by)
  values (v_payment.tenant_id, p_payment_id, p_amount_cents, p_status, p_provider_refund_id,
          nullif(btrim(p_reason), ''), p_actor)
  returning id into v_id;

  insert into public.booking_events (tenant_id, booking_id, event, actor_user_id, actor_kind, data)
  values (
    v_payment.tenant_id, v_payment.booking_id, 'refund_issued', p_actor, p_actor_kind,
    jsonb_build_object('payment_id', p_payment_id, 'refund_id', v_id, 'amount_cents', p_amount_cents,
                       'reason', p_reason)
  );
  return v_id;
end;
$$;

-- Privileges --------------------------------------------------------------------------------------------

revoke all on function
  public.cmd_save_billing(uuid, uuid, public.payment_provider, text, jsonb),
  public.cmd_start_payment(uuid, public.payment_purpose, bigint, public.payment_provider, text, boolean),
  public.cmd_apply_payment_event(
    public.payment_provider, text, text, text, public.payment_status, text, text, jsonb
  ),
  public.cmd_record_refund(uuid, uuid, public.actor_kind, bigint, text, text, public.refund_status)
from public, anon, authenticated;

grant execute on function
  public.cmd_save_billing(uuid, uuid, public.payment_provider, text, jsonb),
  public.cmd_start_payment(uuid, public.payment_purpose, bigint, public.payment_provider, text, boolean),
  public.cmd_apply_payment_event(
    public.payment_provider, text, text, text, public.payment_status, text, text, jsonb
  ),
  public.cmd_record_refund(uuid, uuid, public.actor_kind, bigint, text, text, public.refund_status)
to service_role;
