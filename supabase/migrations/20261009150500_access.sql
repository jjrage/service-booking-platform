-- Read access: row-level security policies and explicit SELECT grants.
--
-- Writes are never granted to anon or authenticated. Every change goes through a cmd_* function that only
-- the service role (the app server) may execute; see the commands migration.

-- Policy helpers. SECURITY DEFINER so they can read memberships regardless of the caller's own policies;
-- each one only answers questions about the current user (auth.uid()).

create function private.has_role(p_tenant_id uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create function private.is_staff(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(p_tenant_id, array['owner', 'dispatcher']::public.member_role[]);
$$;

create function private.is_member(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(p_tenant_id, array['owner', 'dispatcher', 'cleaner']::public.member_role[]);
$$;

create function private.my_crew_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select cm.crew_id from public.crew_members cm where cm.user_id = (select auth.uid());
$$;

create function private.my_client_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clients c where c.user_id = (select auth.uid());
$$;

-- Need to know: a cleaner sees a client's contact details, address and access notes only for jobs of
-- their own crew from 7 days ago to 14 days ahead.
create function private.crew_window_bookings()
returns table (client_id uuid, property_id uuid)
language sql stable security definer set search_path = '' as $$
  select b.client_id, b.property_id
  from public.bookings b
  join public.crew_members cm on cm.crew_id = b.crew_id and cm.user_id = (select auth.uid())
  where b.status in ('confirmed', 'completed', 'no_access')
    and upper(b.arrival_window) > now() - interval '7 days'
    and lower(b.arrival_window) < now() + interval '14 days';
$$;

grant execute on function
  private.has_role(uuid, public.member_role[]),
  private.is_staff(uuid),
  private.is_member(uuid),
  private.my_crew_ids(),
  private.my_client_ids(),
  private.crew_window_bookings()
to authenticated;

-- Row-level security on every table.
alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.services enable row level security;
alter table public.rule_versions enable row level security;
alter table public.clients enable row level security;
alter table public.client_notes enable row level security;
alter table public.properties enable row level security;
alter table public.recurring_plans enable row level security;
alter table public.bookings enable row level security;
alter table public.crew_allocations enable row level security;
alter table public.booking_events enable row level security;
alter table public.dispatch_alerts enable row level security;

-- Public catalog: business profile, services and rules are shown on the public booking page anyway.
grant select on public.tenants, public.services, public.rule_versions to anon, authenticated;

create policy tenants_public_read on public.tenants
  for select to anon, authenticated using (true);
create policy services_public_read on public.services
  for select to anon, authenticated using (true);
create policy rule_versions_public_read on public.rule_versions
  for select to anon, authenticated using (true);

-- Everything else: signed-in users only, filtered by role.
grant select on
  public.memberships,
  public.crews,
  public.crew_members,
  public.clients,
  public.client_notes,
  public.properties,
  public.recurring_plans,
  public.bookings,
  public.crew_allocations,
  public.booking_events,
  public.dispatch_alerts
to authenticated;

create policy memberships_read on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff(tenant_id));

create policy crews_read on public.crews
  for select to authenticated using (private.is_member(tenant_id));

create policy crew_members_read on public.crew_members
  for select to authenticated using (private.is_member(tenant_id));

create policy clients_staff_read on public.clients
  for select to authenticated using (private.is_staff(tenant_id));
create policy clients_self_read on public.clients
  for select to authenticated using (user_id = (select auth.uid()));
create policy clients_crew_read on public.clients
  for select to authenticated
  using (id in (select w.client_id from private.crew_window_bookings() w));

create policy client_notes_staff_read on public.client_notes
  for select to authenticated using (private.is_staff(tenant_id));

create policy properties_staff_read on public.properties
  for select to authenticated using (private.is_staff(tenant_id));
create policy properties_owner_read on public.properties
  for select to authenticated using (client_id in (select private.my_client_ids()));
create policy properties_crew_read on public.properties
  for select to authenticated
  using (id in (select w.property_id from private.crew_window_bookings() w));

create policy recurring_plans_staff_read on public.recurring_plans
  for select to authenticated using (private.is_staff(tenant_id));
create policy recurring_plans_owner_read on public.recurring_plans
  for select to authenticated using (client_id in (select private.my_client_ids()));

create policy bookings_staff_read on public.bookings
  for select to authenticated using (private.is_staff(tenant_id));
create policy bookings_crew_read on public.bookings
  for select to authenticated using (crew_id in (select private.my_crew_ids()));
create policy bookings_owner_read on public.bookings
  for select to authenticated using (client_id in (select private.my_client_ids()));

create policy crew_allocations_staff_read on public.crew_allocations
  for select to authenticated using (private.is_staff(tenant_id));
create policy crew_allocations_crew_read on public.crew_allocations
  for select to authenticated using (crew_id in (select private.my_crew_ids()));

create policy booking_events_staff_read on public.booking_events
  for select to authenticated using (private.is_staff(tenant_id));

create policy dispatch_alerts_staff_read on public.dispatch_alerts
  for select to authenticated using (private.is_staff(tenant_id));
