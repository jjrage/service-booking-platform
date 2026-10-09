-- Scheduling: recurring plans, bookings, crew time allocations (the double-booking guard), booking
-- history, and the dispatcher's attention queue.

-- A recurring plan is stored as a rule in the business's local time; visits are materialized into real
-- bookings ahead of time. The price is fixed when the plan is created (quote snapshot).
create table public.recurring_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid not null,
  property_id uuid not null,
  service_id uuid not null,
  frequency public.plan_frequency not null,
  first_date date not null,
  window_start_local time not null,
  window_end_local time not null,
  timezone text not null check (private.is_valid_timezone(timezone)),
  preferred_crew_id uuid,
  quote jsonb not null check (jsonb_typeof(quote) = 'object'),
  price_cents bigint not null check (price_cents >= 0),
  duration_minutes integer not null check (duration_minutes between 15 and 720),
  currency char(3) not null default 'USD',
  pricing_version_id uuid not null,
  status public.plan_status not null default 'active',
  paused_until date,
  materialized_through date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (window_end_local > window_start_local),
  check (status = 'paused' or paused_until is null),
  foreign key (tenant_id, client_id, property_id) references public.properties (tenant_id, client_id, id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id),
  foreign key (tenant_id, preferred_crew_id) references public.crews (tenant_id, id),
  foreign key (tenant_id, pricing_version_id) references public.rule_versions (tenant_id, id)
);

create trigger recurring_plans_touch_updated_at
  before update on public.recurring_plans
  for each row execute function private.touch_updated_at();

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  -- Human-facing number ("Booking #1042") used in the UI, e-mails and by the AI assistant.
  number bigint generated always as identity unique,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid not null,
  property_id uuid not null,
  service_id uuid not null,
  crew_id uuid not null,
  status public.booking_status not null,
  -- The arrival window the client sees, e.g. [08:00, 09:00) local time, stored in UTC.
  arrival_window tstzrange not null,
  duration_minutes integer not null check (duration_minutes between 15 and 720),
  -- Snapshot of the quote: inputs, line items, totals and the rule version that produced them.
  quote jsonb not null check (jsonb_typeof(quote) = 'object'),
  total_cents bigint not null check (total_cents >= 0),
  deposit_cents bigint not null,
  currency char(3) not null default 'USD',
  pricing_version_id uuid not null,
  cancellation_version_id uuid not null,
  recurring_plan_id uuid,
  occurrence_date date,
  source public.booking_source not null,
  payment_due_by timestamptz,
  cancel_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  unique (tenant_id, id),
  -- Target of the allocation foreign key, so reassigning a booking cascades to its allocation.
  unique (tenant_id, id, crew_id),
  -- Materializing a plan twice cannot create a duplicate visit.
  unique (recurring_plan_id, occurrence_date),
  check (
    not isempty(arrival_window) and lower_inc(arrival_window) and not upper_inc(arrival_window)
    and not lower_inf(arrival_window) and not upper_inf(arrival_window)
  ),
  check (deposit_cents between 0 and total_cents),
  check ((recurring_plan_id is null) = (occurrence_date is null)),
  check (status <> 'pending_payment' or payment_due_by is not null),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  foreign key (tenant_id, client_id, property_id) references public.properties (tenant_id, client_id, id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id),
  foreign key (tenant_id, crew_id) references public.crews (tenant_id, id),
  foreign key (tenant_id, pricing_version_id) references public.rule_versions (tenant_id, id),
  foreign key (tenant_id, cancellation_version_id) references public.rule_versions (tenant_id, id),
  foreign key (tenant_id, recurring_plan_id) references public.recurring_plans (tenant_id, id)
);

create index bookings_tenant_window_idx on public.bookings using gist (tenant_id, arrival_window);
create index bookings_client_idx on public.bookings (tenant_id, client_id);
create index bookings_property_idx on public.bookings (property_id);
create index bookings_crew_idx on public.bookings (crew_id);

create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function private.touch_updated_at();

-- Everything that occupies a crew's time: a short hold while a guest checks out, a booking, or time
-- off. The exclusion constraint makes two overlapping allocations of one crew impossible, whatever
-- the application code does: the second insert or update fails with SQLSTATE 23P01.
create table public.crew_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  crew_id uuid not null,
  kind public.allocation_kind not null,
  -- For a booking: from the start of the arrival window to window end + job duration + travel buffer.
  busy tstzrange not null,
  booking_id uuid unique,
  hold_token uuid unique,
  hold_expires_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, crew_id) references public.crews (tenant_id, id),
  -- Reassigning a booking (bookings.crew_id) cascades here, and the exclusion constraint re-checks it.
  foreign key (tenant_id, booking_id, crew_id)
    references public.bookings (tenant_id, id, crew_id) on update cascade on delete cascade,
  check (
    not isempty(busy) and lower_inc(busy) and not upper_inc(busy)
    and not lower_inf(busy) and not upper_inf(busy)
  ),
  check ((kind = 'booking') = (booking_id is not null)),
  check ((kind = 'hold') = (hold_token is not null and hold_expires_at is not null)),
  constraint crew_allocations_no_overlap exclude using gist (crew_id with =, busy with &&)
);

create index crew_allocations_tenant_idx on public.crew_allocations (tenant_id);
create index crew_allocations_hold_expiry_idx on public.crew_allocations (hold_expires_at)
  where kind = 'hold';

-- Append-only booking history: who did what and when. Written by the cmd_* functions, which know the actor.
create table public.booking_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  booking_id uuid not null,
  event public.booking_event_type not null,
  from_status public.booking_status,
  to_status public.booking_status,
  -- Plain uuid, not a foreign key: an append-only row cannot be rewritten when a user is deleted.
  actor_user_id uuid,
  actor_kind public.actor_kind not null,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create index booking_events_booking_idx on public.booking_events (tenant_id, booking_id, created_at);

create trigger booking_events_append_only
  before update on public.booking_events
  for each row execute function private.reject_update();

revoke update, delete, truncate on public.booking_events from service_role;

-- Items that need a dispatcher: a plan visit no crew could take, an AI hand-off, a failed payment.
create table public.dispatch_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind public.alert_kind not null,
  booking_id uuid,
  plan_id uuid,
  occurrence_date date,
  message text not null check (length(btrim(message)) between 1 and 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  foreign key (tenant_id, plan_id) references public.recurring_plans (tenant_id, id) on delete cascade,
  check ((kind = 'plan_conflict') = (plan_id is not null and occurrence_date is not null))
);

create index dispatch_alerts_open_idx on public.dispatch_alerts (tenant_id, created_at)
  where resolved_at is null;

-- Re-running plan materialization does not pile up duplicate open alerts for the same visit.
create unique index dispatch_alerts_open_plan_conflict_idx
  on public.dispatch_alerts (plan_id, occurrence_date)
  where kind = 'plan_conflict' and resolved_at is null;
