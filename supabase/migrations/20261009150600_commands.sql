-- Commands: the only way data changes.
--
-- The app server calls these with the service role after authenticating the user. Each command runs in
-- one transaction, re-checks that the actor may perform it (defence in depth: a bug in the server's own
-- checks still cannot let a client touch another client's booking), and records an audit event.
--
-- Prices, durations and fees are computed by the server's domain code (one calculation for the booking
-- form, portal, admin and AI) and passed in. The database guarantees the invariants: no overlapping crew
-- time, tenant consistency, valid state transitions.
--
-- Application error codes (SQLSTATE):
--   23P01  exclusion_violation      no crew is free for the requested time (or a direct overlap)
--   42501  insufficient_privilege   the actor may not perform the command
--   22023  invalid_parameter_value  malformed input
--   P0002  no_data_found            the booking, hold or record does not exist
--   BK001                           the held slot expired before the booking was created
--   BK002                           the booking's status does not allow this command

-- Actor checks -------------------------------------------------------------------------------------------

create function private.check_actor(p_actor uuid, p_actor_kind public.actor_kind) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_actor_kind in ('guest', 'system') and p_actor is not null then
    raise exception '% actions cannot carry a user id', p_actor_kind using errcode = 'invalid_parameter_value';
  end if;
  if p_actor_kind in ('client', 'staff', 'crew') and p_actor is null then
    raise exception '% actions need a user id', p_actor_kind using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create function private.require_role(p_actor uuid, p_tenant_id uuid, p_roles public.member_role[])
returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_actor is null or not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = p_actor and m.role = any (p_roles)
  ) then
    raise exception 'actor is not allowed to perform this action' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Staff may change any booking of their tenant; a client (directly or through the AI assistant) only
-- their own; the system (scheduled jobs) any. Guests and crews may not change bookings.
create function private.require_booking_actor(
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_tenant_id uuid,
  p_client_id uuid
) returns void
language plpgsql stable set search_path = '' as $$
begin
  perform private.check_actor(p_actor, p_actor_kind);

  if p_actor_kind = 'system' then
    return;
  elsif p_actor_kind = 'staff' then
    perform private.require_role(p_actor, p_tenant_id, array['owner', 'dispatcher']::public.member_role[]);
    return;
  elsif p_actor_kind in ('client', 'ai') and p_actor is not null and exists (
    select 1
    from public.clients c
    where c.id = p_client_id and c.tenant_id = p_tenant_id and c.user_id = p_actor
  ) then
    return;
  end if;

  raise exception 'actor may not change this booking' using errcode = 'insufficient_privilege';
end;
$$;

create function private.require_valid_busy(p_arrival_window tstzrange, p_busy tstzrange) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_busy is null or p_arrival_window is null
    or lower(p_busy) <> lower(p_arrival_window) or not (p_busy @> p_arrival_window) then
    raise exception 'busy range must start with the arrival window and contain it'
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create function private.require_crews(p_tenant_id uuid, p_crew_ids uuid[]) returns void
language plpgsql stable set search_path = '' as $$
begin
  if coalesce(cardinality(p_crew_ids), 0) = 0 then
    raise exception 'at least one candidate crew is required' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1
    from unnest(p_crew_ids) as candidate (id)
    left join public.crews c on c.id = candidate.id and c.tenant_id = p_tenant_id and c.active
    where c.id is null
  ) then
    raise exception 'unknown or inactive crew' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Serializes commands that change the same crews' time.
--
-- The exclusion constraint alone already guarantees that two overlapping allocations can never both
-- commit. But when many transactions insert overlapping rows at the same moment, each one waits for
-- another's uncommitted row; they deadlock (40P01) or time out, and under a burst of simultaneous
-- checkouts nobody gets the slot. Taking the crew rows' locks first, always in id order, turns that into
-- a queue: exactly one request wins and every other one immediately sees its committed allocation and
-- gets a clean 23P01.
--
-- Lock order across all commands: booking row, then crew rows (sorted), then allocation rows.
-- NO KEY UPDATE does not block the foreign-key checks (KEY SHARE) of other inserts.
create function private.lock_crews(p_tenant_id uuid, p_crew_ids uuid[]) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1
  from public.crews c
  where c.tenant_id = p_tenant_id and c.id = any (p_crew_ids)
  order by c.id
  for no key update;
end;
$$;

-- Holds -------------------------------------------------------------------------------------------------

-- Holds a time range for the first free crew among the candidates (in the server's order of preference).
-- Raises 23P01 when every candidate is taken, e.g. because a concurrent request won the race.
create function public.cmd_hold_slot(
  p_tenant_id uuid,
  p_crew_ids uuid[],
  p_busy tstzrange,
  p_hold_minutes integer,
  p_actor uuid default null
) returns table (allocation_id uuid, crew_id uuid, hold_token uuid, hold_expires_at timestamptz)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_crew_id uuid;
  v_row public.crew_allocations;
begin
  if p_hold_minutes is null or p_hold_minutes not between 1 and 30 then
    raise exception 'a hold lasts 1 to 30 minutes' using errcode = 'invalid_parameter_value';
  end if;
  if p_busy is null or isempty(p_busy) or lower(p_busy) < now() then
    raise exception 'cannot hold an empty range or time in the past' using errcode = 'invalid_parameter_value';
  end if;
  perform private.require_crews(p_tenant_id, p_crew_ids);
  perform private.lock_crews(p_tenant_id, p_crew_ids);

  -- An expired hold still occupies its range until it is removed. Clear them for these crews first.
  delete from public.crew_allocations a
  where a.kind = 'hold' and a.hold_expires_at <= now() and a.crew_id = any (p_crew_ids);

  foreach v_crew_id in array p_crew_ids loop
    begin
      insert into public.crew_allocations (tenant_id, crew_id, kind, busy, hold_token, hold_expires_at)
      values (
        p_tenant_id, v_crew_id, 'hold', p_busy, gen_random_uuid(),
        now() + make_interval(mins => p_hold_minutes)
      )
      returning * into v_row;

      return query select v_row.id, v_row.crew_id, v_row.hold_token, v_row.hold_expires_at;
      return;
    exception
      when exclusion_violation then
        null; -- this crew is taken; try the next candidate
    end;
  end loop;

  raise exception 'no crew is free for the requested time' using errcode = 'exclusion_violation';
end;
$$;

create function public.cmd_release_hold(p_hold_token uuid) returns boolean
language plpgsql set search_path = '' as $$
begin
  delete from public.crew_allocations a where a.kind = 'hold' and a.hold_token = p_hold_token;
  return found;
end;
$$;

-- Bookings ----------------------------------------------------------------------------------------------

-- Creates a booking from a hold (guest checkout) or directly for the first free candidate crew (staff,
-- plans). Finds or creates the client by e-mail and the property by address.
--   p_client:   {"id": uuid} or {"full_name", "email", "phone"}
--   p_property: {"id": uuid} or the address and home details (see public.properties)
create function public.cmd_create_booking(
  p_tenant_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_source public.booking_source,
  p_status public.booking_status,
  p_client jsonb,
  p_property jsonb,
  p_service_id uuid,
  p_arrival_window tstzrange,
  p_busy tstzrange,
  p_duration_minutes integer,
  p_quote jsonb,
  p_total_cents bigint,
  p_deposit_cents bigint,
  p_pricing_version_id uuid,
  p_cancellation_version_id uuid,
  p_hold_token uuid default null,
  p_crew_ids uuid[] default null,
  p_payment_due_by timestamptz default null,
  p_recurring_plan_id uuid default null,
  p_occurrence_date date default null
) returns table (
  booking_id uuid,
  booking_number bigint,
  crew_id uuid,
  client_id uuid,
  property_id uuid
)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_client_id uuid;
  v_property_id uuid;
  v_hold public.crew_allocations;
  v_booking public.bookings;
  v_crew_id uuid;
begin
  perform private.check_actor(p_actor, p_actor_kind);
  perform private.require_valid_busy(p_arrival_window, p_busy);

  if p_status not in ('pending_payment', 'confirmed') then
    raise exception 'a new booking is pending payment or confirmed' using errcode = 'invalid_parameter_value';
  end if;
  -- Only staff and the system (plan visits, card on file) may skip the deposit step.
  if p_status = 'confirmed' and p_actor_kind not in ('staff', 'system') then
    raise exception 'only staff can create a confirmed booking' using errcode = 'insufficient_privilege';
  end if;
  if (p_status = 'pending_payment') <> (p_payment_due_by is not null) then
    raise exception 'payment_due_by is required exactly for pending payment'
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_hold_token is null) = (coalesce(cardinality(p_crew_ids), 0) = 0) then
    raise exception 'pass either a hold token or candidate crews' using errcode = 'invalid_parameter_value';
  end if;
  if p_actor_kind = 'staff' then
    perform private.require_role(p_actor, p_tenant_id, array['owner', 'dispatcher']::public.member_role[]);
  end if;

  -- Client ------------------------------------------------------------------------------------------------
  if p_client ? 'id' then
    v_client_id := (p_client ->> 'id')::uuid;
    if not exists (select 1 from public.clients c where c.id = v_client_id and c.tenant_id = p_tenant_id) then
      raise exception 'unknown client' using errcode = 'no_data_found';
    end if;
  else
    -- A signed-in client always books as themselves, never by typing someone else's e-mail.
    if p_actor is not null and p_actor_kind in ('client', 'ai') then
      raise exception 'a signed-in client books with their client id' using errcode = 'invalid_parameter_value';
    end if;

    insert into public.clients as c (tenant_id, full_name, email, phone, source)
    values (
      p_tenant_id,
      p_client ->> 'full_name',
      p_client ->> 'email',
      nullif(p_client ->> 'phone', ''),
      case p_source
        when 'web' then 'web'::public.client_source
        when 'portal' then 'portal'::public.client_source
        when 'ai' then 'ai'::public.client_source
        else 'admin'::public.client_source
      end
    )
    -- An existing client keeps their name; a missing phone is filled in.
    on conflict (tenant_id, email) do update set phone = coalesce(c.phone, excluded.phone)
    returning c.id into v_client_id;
  end if;

  if p_actor_kind in ('client', 'ai') and p_actor is not null and not exists (
    select 1 from public.clients c where c.id = v_client_id and c.user_id = p_actor
  ) then
    raise exception 'a client may only book for themselves' using errcode = 'insufficient_privilege';
  end if;

  -- Property ----------------------------------------------------------------------------------------------
  if p_property ? 'id' then
    -- Ownership is enforced by the bookings foreign key (tenant, client, property).
    v_property_id := (p_property ->> 'id')::uuid;
  else
    select p.id into v_property_id
    from public.properties p
    where p.tenant_id = p_tenant_id
      and p.client_id = v_client_id
      and lower(btrim(p.address_line1)) = lower(btrim(p_property ->> 'address_line1'))
      and p.zip = p_property ->> 'zip'
    limit 1;

    if v_property_id is null then
      insert into public.properties (
        tenant_id, client_id, label, address_line1, address_line2, city, state, zip,
        bedrooms, full_baths, half_baths, sqft, has_pets, pet_notes, access_notes, parking_notes
      )
      values (
        p_tenant_id, v_client_id,
        coalesce(nullif(p_property ->> 'label', ''), 'Home'),
        p_property ->> 'address_line1',
        nullif(p_property ->> 'address_line2', ''),
        p_property ->> 'city',
        p_property ->> 'state',
        p_property ->> 'zip',
        (p_property ->> 'bedrooms')::integer,
        (p_property ->> 'full_baths')::integer,
        coalesce((p_property ->> 'half_baths')::integer, 0),
        (p_property ->> 'sqft')::integer,
        coalesce((p_property ->> 'has_pets')::boolean, false),
        nullif(p_property ->> 'pet_notes', ''),
        nullif(p_property ->> 'access_notes', ''),
        nullif(p_property ->> 'parking_notes', '')
      )
      returning id into v_property_id;
    else
      -- Same home booked again: keep its details current; notes are only replaced when provided.
      update public.properties p
      set bedrooms = (p_property ->> 'bedrooms')::integer,
          full_baths = (p_property ->> 'full_baths')::integer,
          half_baths = coalesce((p_property ->> 'half_baths')::integer, 0),
          sqft = coalesce((p_property ->> 'sqft')::integer, p.sqft),
          has_pets = coalesce((p_property ->> 'has_pets')::boolean, p.has_pets),
          pet_notes = coalesce(nullif(p_property ->> 'pet_notes', ''), p.pet_notes),
          access_notes = coalesce(nullif(p_property ->> 'access_notes', ''), p.access_notes),
          parking_notes = coalesce(nullif(p_property ->> 'parking_notes', ''), p.parking_notes)
      where p.id = v_property_id;
    end if;
  end if;

  -- Booking and crew time ---------------------------------------------------------------------------------
  if p_hold_token is not null then
    -- Find the hold's crew without locking, lock the crew (lock order: crews before allocations), then
    -- lock and re-read the hold: it may have expired or been cleared in between.
    select a.crew_id into v_crew_id
    from public.crew_allocations a
    where a.hold_token = p_hold_token and a.tenant_id = p_tenant_id and a.kind = 'hold';

    if found then
      perform private.lock_crews(p_tenant_id, array[v_crew_id]);

      select * into v_hold
      from public.crew_allocations a
      where a.hold_token = p_hold_token and a.tenant_id = p_tenant_id and a.kind = 'hold'
      for update;
    end if;

    if v_hold.id is null or v_hold.hold_expires_at <= now() then
      raise exception 'the held time slot has expired' using errcode = 'BK001';
    end if;

    insert into public.bookings (
      tenant_id, client_id, property_id, service_id, crew_id, status, arrival_window,
      duration_minutes, quote, total_cents, deposit_cents, pricing_version_id, cancellation_version_id,
      recurring_plan_id, occurrence_date, source, payment_due_by, created_by, confirmed_at
    )
    values (
      p_tenant_id, v_client_id, v_property_id, p_service_id, v_hold.crew_id, p_status, p_arrival_window,
      p_duration_minutes, p_quote, p_total_cents, p_deposit_cents, p_pricing_version_id,
      p_cancellation_version_id, p_recurring_plan_id, p_occurrence_date, p_source, p_payment_due_by,
      p_actor, case when p_status = 'confirmed' then now() end
    )
    returning * into v_booking;

    -- The hold becomes the booking's allocation. If the final range differs from the held one, the
    -- exclusion constraint checks it again.
    update public.crew_allocations a
    set kind = 'booking', booking_id = v_booking.id, busy = p_busy, hold_token = null, hold_expires_at = null
    where a.id = v_hold.id;
  else
    perform private.require_crews(p_tenant_id, p_crew_ids);
    perform private.lock_crews(p_tenant_id, p_crew_ids);

    foreach v_crew_id in array p_crew_ids loop
      begin
        insert into public.bookings (
          tenant_id, client_id, property_id, service_id, crew_id, status, arrival_window,
          duration_minutes, quote, total_cents, deposit_cents, pricing_version_id, cancellation_version_id,
          recurring_plan_id, occurrence_date, source, payment_due_by, created_by, confirmed_at
        )
        values (
          p_tenant_id, v_client_id, v_property_id, p_service_id, v_crew_id, p_status, p_arrival_window,
          p_duration_minutes, p_quote, p_total_cents, p_deposit_cents, p_pricing_version_id,
          p_cancellation_version_id, p_recurring_plan_id, p_occurrence_date, p_source, p_payment_due_by,
          p_actor, case when p_status = 'confirmed' then now() end
        )
        returning * into v_booking;

        insert into public.crew_allocations (tenant_id, crew_id, kind, busy, booking_id)
        values (p_tenant_id, v_crew_id, 'booking', p_busy, v_booking.id);

        exit; -- booked
      exception
        when exclusion_violation then
          v_booking := null; -- this crew is taken; the sub-transaction rolled back the booking too
      end;
    end loop;

    if v_booking.id is null then
      raise exception 'no crew is free for the requested time' using errcode = 'exclusion_violation';
    end if;
  end if;

  insert into public.booking_events (
    tenant_id, booking_id, event, to_status, actor_user_id, actor_kind, data
  )
  values (
    p_tenant_id, v_booking.id, 'created', p_status, p_actor, p_actor_kind,
    jsonb_build_object(
      'source', p_source,
      'crew_id', v_booking.crew_id,
      'arrival_window', p_arrival_window,
      'total_cents', p_total_cents
    )
  );

  return query select v_booking.id, v_booking.number, v_booking.crew_id, v_client_id, v_property_id;
end;
$$;

-- Moves a booking to a new arrival window, keeping its crew when it is free and otherwise trying the
-- other candidates. The fee (if any) is computed by the server's cancellation rules and recorded here;
-- charging it is the payments layer's job.
create function public.cmd_reschedule_booking(
  p_booking_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_arrival_window tstzrange,
  p_busy tstzrange,
  p_crew_ids uuid[],
  p_fee_cents bigint default 0
) returns table (booking_id uuid, crew_id uuid)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_booking public.bookings;
  v_crew_id uuid;
  v_moved boolean := false;
begin
  select * into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;

  perform private.require_booking_actor(p_actor, p_actor_kind, v_booking.tenant_id, v_booking.client_id);
  perform private.require_valid_busy(p_arrival_window, p_busy);
  perform private.require_crews(v_booking.tenant_id, p_crew_ids);

  if v_booking.status not in ('pending_payment', 'confirmed') then
    raise exception 'a % booking cannot be rescheduled', v_booking.status using errcode = 'BK002';
  end if;
  if lower(p_busy) < now() then
    raise exception 'cannot reschedule into the past' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_fee_cents, -1) < 0 then
    raise exception 'fee must be zero or positive' using errcode = 'invalid_parameter_value';
  end if;

  perform private.lock_crews(v_booking.tenant_id, p_crew_ids || v_booking.crew_id);

  foreach v_crew_id in array p_crew_ids loop
    begin
      -- Free the old time first so the move is checked against everyone else's time only.
      delete from public.crew_allocations a where a.booking_id = p_booking_id;

      update public.bookings b
      set crew_id = v_crew_id, arrival_window = p_arrival_window
      where b.id = p_booking_id;

      insert into public.crew_allocations (tenant_id, crew_id, kind, busy, booking_id)
      values (v_booking.tenant_id, v_crew_id, 'booking', p_busy, p_booking_id);

      v_moved := true;
      exit;
    exception
      when exclusion_violation then
        null; -- the sub-transaction restored the old allocation; try the next crew
    end;
  end loop;

  if not v_moved then
    raise exception 'no crew is free for the requested time' using errcode = 'exclusion_violation';
  end if;

  insert into public.booking_events (
    tenant_id, booking_id, event, from_status, to_status, actor_user_id, actor_kind, data
  )
  values (
    v_booking.tenant_id, p_booking_id, 'rescheduled', v_booking.status, v_booking.status, p_actor,
    p_actor_kind,
    jsonb_build_object(
      'from_window', v_booking.arrival_window,
      'to_window', p_arrival_window,
      'from_crew_id', v_booking.crew_id,
      'to_crew_id', v_crew_id,
      'fee_cents', p_fee_cents
    )
  );

  return query select p_booking_id, v_crew_id;
end;
$$;

-- Gives a booking to another crew. The allocation follows through the cascading foreign key, and the
-- exclusion constraint rejects a crew that is busy at that time (23P01).
create function public.cmd_reassign_booking(p_booking_id uuid, p_actor uuid, p_crew_id uuid)
returns void
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;

  perform private.require_role(p_actor, v_booking.tenant_id, array['owner', 'dispatcher']::public.member_role[]);
  perform private.require_crews(v_booking.tenant_id, array[p_crew_id]);

  if v_booking.status not in ('pending_payment', 'confirmed') then
    raise exception 'a % booking cannot be reassigned', v_booking.status using errcode = 'BK002';
  end if;
  if v_booking.crew_id = p_crew_id then
    return;
  end if;

  perform private.lock_crews(v_booking.tenant_id, array[v_booking.crew_id, p_crew_id]);
  update public.bookings b set crew_id = p_crew_id where b.id = p_booking_id;

  insert into public.booking_events (
    tenant_id, booking_id, event, from_status, to_status, actor_user_id, actor_kind, data
  )
  values (
    v_booking.tenant_id, p_booking_id, 'reassigned', v_booking.status, v_booking.status, p_actor, 'staff',
    jsonb_build_object('from_crew_id', v_booking.crew_id, 'to_crew_id', p_crew_id)
  );
end;
$$;

create function public.cmd_cancel_booking(
  p_booking_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_reason text,
  p_fee_cents bigint default 0
) returns void
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;

  perform private.require_booking_actor(p_actor, p_actor_kind, v_booking.tenant_id, v_booking.client_id);

  if v_booking.status not in ('pending_payment', 'confirmed') then
    raise exception 'a % booking cannot be cancelled', v_booking.status using errcode = 'BK002';
  end if;
  if coalesce(p_fee_cents, -1) < 0 or p_fee_cents > v_booking.total_cents then
    raise exception 'fee must be between zero and the booking total' using errcode = 'invalid_parameter_value';
  end if;

  update public.bookings b
  set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), '')
  where b.id = p_booking_id;

  -- The crew's time is free again.
  delete from public.crew_allocations a where a.booking_id = p_booking_id;

  insert into public.booking_events (
    tenant_id, booking_id, event, from_status, to_status, actor_user_id, actor_kind, data
  )
  values (
    v_booking.tenant_id, p_booking_id, 'cancelled', v_booking.status, 'cancelled', p_actor, p_actor_kind,
    jsonb_build_object('reason', p_reason, 'fee_cents', p_fee_cents)
  );
end;
$$;

-- Crew time off ----------------------------------------------------------------------------------------

-- Time off lives in the same table as bookings, so it can neither overlap an existing booking nor be
-- booked over later (23P01 either way).
create function public.cmd_add_time_off(
  p_tenant_id uuid,
  p_actor uuid,
  p_crew_id uuid,
  p_period tstzrange,
  p_note text default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_role(p_actor, p_tenant_id, array['owner', 'dispatcher']::public.member_role[]);
  perform private.require_crews(p_tenant_id, array[p_crew_id]);
  perform private.lock_crews(p_tenant_id, array[p_crew_id]);

  insert into public.crew_allocations (tenant_id, crew_id, kind, busy, note)
  values (p_tenant_id, p_crew_id, 'time_off', p_period, nullif(btrim(p_note), ''))
  returning id into v_id;

  return v_id;
end;
$$;

create function public.cmd_remove_time_off(p_allocation_id uuid, p_actor uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_tenant_id uuid;
begin
  select a.tenant_id into v_tenant_id
  from public.crew_allocations a
  where a.id = p_allocation_id and a.kind = 'time_off';

  if not found then
    raise exception 'time off not found' using errcode = 'no_data_found';
  end if;

  perform private.require_role(p_actor, v_tenant_id, array['owner', 'dispatcher']::public.member_role[]);
  delete from public.crew_allocations a where a.id = p_allocation_id;
end;
$$;

-- Rules -------------------------------------------------------------------------------------------------

-- Publishes the next version of one kind of rules. Only the owner changes rules.
create function public.cmd_publish_rules(
  p_tenant_id uuid,
  p_actor uuid,
  p_kind public.rule_kind,
  p_rules jsonb,
  p_note text default '',
  p_effective_from timestamptz default now()
) returns table (rule_version_id uuid, version integer)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_version integer;
  v_id uuid;
begin
  perform private.require_role(p_actor, p_tenant_id, array['owner']::public.member_role[]);

  -- Serialize publishers of the same tenant so version numbers stay gapless.
  perform 1 from public.tenants t where t.id = p_tenant_id for update;

  select coalesce(max(r.version), 0) + 1 into v_version
  from public.rule_versions r
  where r.tenant_id = p_tenant_id and r.kind = p_kind;

  insert into public.rule_versions (tenant_id, kind, version, rules, effective_from, note, created_by)
  values (p_tenant_id, p_kind, v_version, p_rules, p_effective_from, coalesce(p_note, ''), p_actor)
  returning id into v_id;

  return query select v_id, v_version;
end;
$$;

-- Scheduled job -----------------------------------------------------------------------------------------

-- Removes expired holds and expires bookings whose deposit was not paid in time. Safe to run often.
create function public.cmd_expire_stale() returns table (holds_removed integer, bookings_expired integer)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_holds integer;
  v_expired integer;
begin
  delete from public.crew_allocations a where a.kind = 'hold' and a.hold_expires_at <= now();
  get diagnostics v_holds = row_count;

  with expired as (
    update public.bookings b
    set status = 'expired'
    where b.status = 'pending_payment' and b.payment_due_by <= now()
    returning b.id, b.tenant_id
  ),
  freed as (
    delete from public.crew_allocations a
    using expired e
    where a.booking_id = e.id
  )
  insert into public.booking_events (tenant_id, booking_id, event, from_status, to_status, actor_kind, data)
  select e.tenant_id, e.id, 'expired', 'pending_payment', 'expired', 'system',
         jsonb_build_object('reason', 'deposit not paid in time')
  from expired e;
  get diagnostics v_expired = row_count;

  return query select v_holds, v_expired;
end;
$$;

-- Public read ------------------------------------------------------------------------------------------

-- Busy ranges of a tenant's active crews, for computing open arrival windows on the public booking page.
-- Exposes only "crew X is busy from A to B": no clients, addresses or booking details.
create function public.public_busy(p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
returns table (crew_id uuid, busy tstzrange)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '70 days' then
    raise exception 'range must be positive and at most 70 days' using errcode = 'invalid_parameter_value';
  end if;

  return query
  select a.crew_id, a.busy
  from public.crew_allocations a
  join public.crews c on c.id = a.crew_id and c.active
  where a.tenant_id = p_tenant_id
    and a.busy && tstzrange(p_from, p_to)
    and (a.kind <> 'hold' or a.hold_expires_at > now())
  order by a.crew_id, lower(a.busy);
end;
$$;

-- Privileges --------------------------------------------------------------------------------------------

-- Commands: the app server (service role) only. Default privileges already withhold EXECUTE from the
-- browser-facing roles; the explicit revoke documents the intent and is asserted by tests.
revoke all on function
  public.cmd_hold_slot(uuid, uuid[], tstzrange, integer, uuid),
  public.cmd_release_hold(uuid),
  public.cmd_create_booking(
    uuid, uuid, public.actor_kind, public.booking_source, public.booking_status, jsonb, jsonb, uuid,
    tstzrange, tstzrange, integer, jsonb, bigint, bigint, uuid, uuid, uuid, uuid[], timestamptz, uuid, date
  ),
  public.cmd_reschedule_booking(uuid, uuid, public.actor_kind, tstzrange, tstzrange, uuid[], bigint),
  public.cmd_reassign_booking(uuid, uuid, uuid),
  public.cmd_cancel_booking(uuid, uuid, public.actor_kind, text, bigint),
  public.cmd_add_time_off(uuid, uuid, uuid, tstzrange, text),
  public.cmd_remove_time_off(uuid, uuid),
  public.cmd_publish_rules(uuid, uuid, public.rule_kind, jsonb, text, timestamptz),
  public.cmd_expire_stale()
from public, anon, authenticated;

grant execute on function
  public.cmd_hold_slot(uuid, uuid[], tstzrange, integer, uuid),
  public.cmd_release_hold(uuid),
  public.cmd_create_booking(
    uuid, uuid, public.actor_kind, public.booking_source, public.booking_status, jsonb, jsonb, uuid,
    tstzrange, tstzrange, integer, jsonb, bigint, bigint, uuid, uuid, uuid, uuid[], timestamptz, uuid, date
  ),
  public.cmd_reschedule_booking(uuid, uuid, public.actor_kind, tstzrange, tstzrange, uuid[], bigint),
  public.cmd_reassign_booking(uuid, uuid, uuid),
  public.cmd_cancel_booking(uuid, uuid, public.actor_kind, text, bigint),
  public.cmd_add_time_off(uuid, uuid, uuid, tstzrange, text),
  public.cmd_remove_time_off(uuid, uuid),
  public.cmd_publish_rules(uuid, uuid, public.rule_kind, jsonb, text, timestamptz),
  public.cmd_expire_stale()
to service_role;

grant execute on function
  private.check_actor(uuid, public.actor_kind),
  private.require_role(uuid, uuid, public.member_role[]),
  private.require_booking_actor(uuid, public.actor_kind, uuid, uuid),
  private.require_valid_busy(tstzrange, tstzrange),
  private.require_crews(uuid, uuid[]),
  private.lock_crews(uuid, uuid[])
to service_role;

revoke all on function public.public_busy(uuid, timestamptz, timestamptz) from public;
grant execute on function public.public_busy(uuid, timestamptz, timestamptz)
  to anon, authenticated, service_role;
