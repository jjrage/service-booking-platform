-- Client portal: account linking, profile and home notes, and recurring plans (start, pause, resume,
-- cancel, conflict alerts). Visits of a plan are ordinary bookings; the server materializes them ahead of
-- time with cmd_create_booking, so they pass the same exclusion constraint as every other booking.

-- Plans start themselves ----------------------------------------------------------------------------------

-- When the first visit of a plan is confirmed (its card saved), the plan is created from the visit's quote
-- snapshot: same local weekday and window, same crew preferred, the regular-visit price fixed. Whatever
-- confirms the booking (the payment webhook, the simulator, staff) starts the plan in the same transaction.
create function private.start_plan_on_confirm() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_tz text;
  v_recurring jsonb := new.quote -> 'recurringVisit';
  v_service_id uuid;
  v_plan_id uuid;
begin
  select t.timezone into v_tz from public.tenants t where t.id = new.tenant_id;

  select s.id into v_service_id
  from public.services s
  where s.tenant_id = new.tenant_id and s.code = v_recurring ->> 'service';

  insert into public.recurring_plans (
    tenant_id, client_id, property_id, service_id, frequency, first_date, window_start_local,
    window_end_local, timezone, preferred_crew_id, quote, price_cents, duration_minutes, currency,
    pricing_version_id, materialized_through, created_by
  )
  values (
    new.tenant_id, new.client_id, new.property_id, coalesce(v_service_id, new.service_id),
    (new.quote ->> 'frequency')::public.plan_frequency,
    (lower(new.arrival_window) at time zone v_tz)::date,
    (lower(new.arrival_window) at time zone v_tz)::time,
    (upper(new.arrival_window) at time zone v_tz)::time,
    v_tz, new.crew_id, new.quote,
    (v_recurring ->> 'totalCents')::bigint, (v_recurring ->> 'durationMinutes')::integer, new.currency,
    new.pricing_version_id, (lower(new.arrival_window) at time zone v_tz)::date, new.created_by
  )
  returning id into v_plan_id;

  new.recurring_plan_id := v_plan_id;
  new.occurrence_date := (lower(new.arrival_window) at time zone v_tz)::date;
  return new;
end;
$$;

create trigger bookings_start_plan
  before update of status on public.bookings
  for each row
  when (
    old.status = 'pending_payment' and new.status = 'confirmed' and new.recurring_plan_id is null
    and new.quote ->> 'frequency' in ('weekly', 'biweekly', 'monthly')
    and new.quote -> 'recurringVisit' is not null
    and jsonb_typeof(new.quote -> 'recurringVisit') = 'object'
  )
  execute function private.start_plan_on_confirm();

-- Accounts and profile ------------------------------------------------------------------------------------

-- Links a signed-in user to the client records with their (verified) e-mail, in every business they booked
-- with. Called after a magic-link sign-in, which proves the user owns the address.
create function public.cmd_link_client_account(p_user_id uuid, p_email text) returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  update public.clients c
  set user_id = p_user_id
  -- Compared as lower-case text: with an empty search_path the citext operators are not in scope.
  where lower(c.email::text) = lower(btrim(p_email)) and c.user_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.cmd_update_client_contact(
  p_client_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_full_name text,
  p_phone text
) returns void
language plpgsql set search_path = '' as $$
declare
  v_tenant_id uuid;
begin
  select c.tenant_id into v_tenant_id from public.clients c where c.id = p_client_id;
  if not found then
    raise exception 'client not found' using errcode = 'no_data_found';
  end if;
  perform private.require_booking_actor(p_actor, p_actor_kind, v_tenant_id, p_client_id);

  update public.clients c
  set full_name = btrim(p_full_name), phone = nullif(btrim(p_phone), '')
  where c.id = p_client_id;
end;
$$;

create function public.cmd_update_property_notes(
  p_property_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_has_pets boolean,
  p_pet_notes text,
  p_access_notes text,
  p_parking_notes text
) returns void
language plpgsql set search_path = '' as $$
declare
  v_property public.properties;
begin
  select * into v_property from public.properties p where p.id = p_property_id;
  if not found then
    raise exception 'home not found' using errcode = 'no_data_found';
  end if;
  perform private.require_booking_actor(p_actor, p_actor_kind, v_property.tenant_id, v_property.client_id);

  update public.properties p
  set has_pets = coalesce(p_has_pets, p.has_pets),
      pet_notes = nullif(btrim(p_pet_notes), ''),
      access_notes = nullif(btrim(p_access_notes), ''),
      parking_notes = nullif(btrim(p_parking_notes), '')
  where p.id = p_property_id;
end;
$$;

-- Plans -------------------------------------------------------------------------------------------------

-- Cancels a plan's upcoming visits that start at or after p_free_after (the free-cancellation boundary the
-- server computed from the rules) and, for a pause, on or before p_until. Nearer visits stay: the client
-- can cancel those one by one, under the usual fee rules.
create function private.cancel_plan_visits(
  p_plan public.recurring_plans,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_free_after timestamptz,
  p_until date,
  p_reason text
) returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  with cancelled as (
    update public.bookings b
    set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    where b.recurring_plan_id = p_plan.id
      and b.status = 'confirmed'
      and lower(b.arrival_window) >= p_free_after
      and (p_until is null or b.occurrence_date <= p_until)
    returning b.id, b.tenant_id
  ),
  freed as (
    delete from public.crew_allocations a using cancelled c where a.booking_id = c.id
  )
  insert into public.booking_events (
    tenant_id, booking_id, event, from_status, to_status, actor_user_id, actor_kind, data
  )
  select c.tenant_id, c.id, 'cancelled', 'confirmed', 'cancelled', p_actor, p_actor_kind,
         jsonb_build_object('reason', p_reason, 'fee_cents', 0)
  from cancelled c;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.cmd_pause_plan(
  p_plan_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_until date,
  p_free_after timestamptz
) returns integer
language plpgsql set search_path = '' as $$
declare
  v_plan public.recurring_plans;
begin
  select * into v_plan from public.recurring_plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'plan not found' using errcode = 'no_data_found';
  end if;
  perform private.require_booking_actor(p_actor, p_actor_kind, v_plan.tenant_id, v_plan.client_id);
  if v_plan.status <> 'active' then
    raise exception 'a % plan cannot be paused', v_plan.status using errcode = 'BK002';
  end if;
  if p_until is null or p_until <= current_date or p_until > current_date + 180 then
    raise exception 'pause until a date within the next 6 months' using errcode = 'invalid_parameter_value';
  end if;

  update public.recurring_plans p set status = 'paused', paused_until = p_until where p.id = p_plan_id;
  return private.cancel_plan_visits(v_plan, p_actor, p_actor_kind, p_free_after, p_until, 'Plan paused');
end;
$$;

create function public.cmd_resume_plan(p_plan_id uuid, p_actor uuid, p_actor_kind public.actor_kind)
returns void
language plpgsql set search_path = '' as $$
declare
  v_plan public.recurring_plans;
begin
  select * into v_plan from public.recurring_plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'plan not found' using errcode = 'no_data_found';
  end if;
  perform private.require_booking_actor(p_actor, p_actor_kind, v_plan.tenant_id, v_plan.client_id);
  if v_plan.status <> 'paused' then
    raise exception 'a % plan cannot be resumed', v_plan.status using errcode = 'BK002';
  end if;

  update public.recurring_plans p set status = 'active', paused_until = null where p.id = p_plan_id;
end;
$$;

create function public.cmd_cancel_plan(
  p_plan_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_free_after timestamptz
) returns integer
language plpgsql set search_path = '' as $$
declare
  v_plan public.recurring_plans;
begin
  select * into v_plan from public.recurring_plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'plan not found' using errcode = 'no_data_found';
  end if;
  perform private.require_booking_actor(p_actor, p_actor_kind, v_plan.tenant_id, v_plan.client_id);
  if v_plan.status = 'cancelled' then
    raise exception 'the plan is already cancelled' using errcode = 'BK002';
  end if;

  update public.recurring_plans p set status = 'cancelled', paused_until = null where p.id = p_plan_id;
  return private.cancel_plan_visits(v_plan, p_actor, p_actor_kind, p_free_after, null, 'Plan cancelled');
end;
$$;

-- Records how far a plan's visits have been created. Moves forward only.
create function public.cmd_mark_plan_materialized(p_plan_id uuid, p_through date) returns void
language plpgsql set search_path = '' as $$
begin
  update public.recurring_plans p
  set materialized_through = greatest(coalesce(p.materialized_through, p_through), p_through),
      -- A pause that has run out ends by itself.
      status = case when p.status = 'paused' and p.paused_until < current_date then 'active' else p.status end,
      paused_until = case when p.status = 'paused' and p.paused_until < current_date then null else p.paused_until end
  where p.id = p_plan_id;
end;
$$;

-- A plan visit no crew could take goes to the dispatcher's queue (once per visit while unresolved).
create function public.cmd_raise_plan_conflict(p_plan_id uuid, p_occurrence_date date, p_message text)
returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.dispatch_alerts (tenant_id, kind, plan_id, occurrence_date, message)
  select p.tenant_id, 'plan_conflict', p.id, p_occurrence_date, p_message
  from public.recurring_plans p
  where p.id = p_plan_id
  on conflict (plan_id, occurrence_date) where kind = 'plan_conflict' and resolved_at is null do nothing;
end;
$$;

-- Privileges --------------------------------------------------------------------------------------------

revoke all on function
  public.cmd_link_client_account(uuid, text),
  public.cmd_update_client_contact(uuid, uuid, public.actor_kind, text, text),
  public.cmd_update_property_notes(uuid, uuid, public.actor_kind, boolean, text, text, text),
  public.cmd_pause_plan(uuid, uuid, public.actor_kind, date, timestamptz),
  public.cmd_resume_plan(uuid, uuid, public.actor_kind),
  public.cmd_cancel_plan(uuid, uuid, public.actor_kind, timestamptz),
  public.cmd_mark_plan_materialized(uuid, date),
  public.cmd_raise_plan_conflict(uuid, date, text)
from public, anon, authenticated;

grant execute on function
  public.cmd_link_client_account(uuid, text),
  public.cmd_update_client_contact(uuid, uuid, public.actor_kind, text, text),
  public.cmd_update_property_notes(uuid, uuid, public.actor_kind, boolean, text, text, text),
  public.cmd_pause_plan(uuid, uuid, public.actor_kind, date, timestamptz),
  public.cmd_resume_plan(uuid, uuid, public.actor_kind),
  public.cmd_cancel_plan(uuid, uuid, public.actor_kind, timestamptz),
  public.cmd_mark_plan_materialized(uuid, date),
  public.cmd_raise_plan_conflict(uuid, date, text)
to service_role;

grant execute on function private.cancel_plan_visits(
  public.recurring_plans, uuid, public.actor_kind, timestamptz, date, text
) to service_role;
