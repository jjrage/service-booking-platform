-- Test support, installed once per run and kept (not rolled back) so every test file can use it.
-- Lives in the `tests` schema of the local database only; it is not part of the application schema.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Named fixture ids keep the tests readable: tests.id('crew_a1') instead of a raw uuid.
create or replace function tests.id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select v.id
  from (values
    ('tenant_a',       'a0000000-0000-4000-8000-000000000001'::uuid),
    ('tenant_b',       'b0000000-0000-4000-8000-000000000001'),
    ('a_owner',        'a1000000-0000-4000-8000-000000000001'),
    ('a_dispatcher',   'a1000000-0000-4000-8000-000000000002'),
    ('a_cleaner1',     'a1000000-0000-4000-8000-000000000003'),
    ('a_cleaner2',     'a1000000-0000-4000-8000-000000000004'),
    ('a_client',       'a1000000-0000-4000-8000-000000000005'),
    ('b_owner',        'b1000000-0000-4000-8000-000000000001'),
    ('b_client',       'b1000000-0000-4000-8000-000000000002'),
    ('crew_a1',        'a2000000-0000-4000-8000-000000000001'),
    ('crew_a2',        'a2000000-0000-4000-8000-000000000002'),
    ('crew_b1',        'b2000000-0000-4000-8000-000000000001'),
    ('service_a',      'a3000000-0000-4000-8000-000000000001'),
    ('service_b',      'b3000000-0000-4000-8000-000000000001'),
    ('pricing_a',      'a4000000-0000-4000-8000-000000000001'),
    ('schedule_a',     'a4000000-0000-4000-8000-000000000002'),
    ('cancellation_a', 'a4000000-0000-4000-8000-000000000003'),
    ('pricing_b',      'b4000000-0000-4000-8000-000000000001'),
    ('cancellation_b', 'b4000000-0000-4000-8000-000000000002'),
    ('client_1',       'a5000000-0000-4000-8000-000000000001'),
    ('client_2',       'a5000000-0000-4000-8000-000000000002'),
    ('client_b',       'b5000000-0000-4000-8000-000000000001'),
    ('property_1',     'a6000000-0000-4000-8000-000000000001'),
    ('property_2',     'a6000000-0000-4000-8000-000000000002'),
    ('property_4',     'a6000000-0000-4000-8000-000000000004'),
    ('property_5',     'a6000000-0000-4000-8000-000000000005'),
    ('property_b',     'b6000000-0000-4000-8000-000000000001'),
    ('booking_1',      'a7000000-0000-4000-8000-000000000001'),
    ('booking_2',      'a7000000-0000-4000-8000-000000000002'),
    ('booking_3',      'a7000000-0000-4000-8000-000000000003'),
    ('booking_4',      'a7000000-0000-4000-8000-000000000004'),
    ('booking_b',      'b7000000-0000-4000-8000-000000000001')
  ) as v (name, id)
  where v.name = p_name;
$$;

-- Start of the next whole hour, one day ahead. now() is fixed within a test's transaction.
create or replace function tests.tomorrow() returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc('hour', now()) + interval '1 day';
$$;

create or replace function tests.create_user(p_id uuid, p_email text) returns void
language sql security definer set search_path = '' as $$
  insert into auth.users (id, email, aud, role, instance_id, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
          '{}', '{}', now(), now())
  on conflict (id) do nothing;
$$;

-- Act as a signed-in user for the rest of the transaction (as the Data API would after verifying a JWT).
create or replace function tests.authenticate_as(p_user_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.authenticate_as_anon() returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function tests.clear_authentication() returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- A booking with its crew allocation: one-hour arrival window, two-hour job, 30-minute travel buffer.
create or replace function tests.add_booking(
  p_name text,
  p_tenant text,
  p_client text,
  p_property text,
  p_crew text,
  p_status public.booking_status,
  p_window_start timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant_id uuid := tests.id(p_tenant);
  v_is_a boolean := p_tenant = 'tenant_a';
begin
  insert into public.bookings (
    id, tenant_id, client_id, property_id, service_id, crew_id, status, arrival_window,
    duration_minutes, quote, total_cents, deposit_cents, pricing_version_id, cancellation_version_id,
    source, confirmed_at, completed_at
  )
  values (
    tests.id(p_name), v_tenant_id, tests.id(p_client), tests.id(p_property),
    tests.id(case when v_is_a then 'service_a' else 'service_b' end), tests.id(p_crew), p_status,
    tstzrange(p_window_start, p_window_start + interval '1 hour'),
    120, '{}', 20000, 5000,
    tests.id(case when v_is_a then 'pricing_a' else 'pricing_b' end),
    tests.id(case when v_is_a then 'cancellation_a' else 'cancellation_b' end),
    'web', now(), case when p_status = 'completed' then p_window_start + interval '3 hours' end
  );

  insert into public.crew_allocations (tenant_id, crew_id, kind, busy, booking_id)
  values (
    v_tenant_id, tests.id(p_crew), 'booking',
    tstzrange(p_window_start, p_window_start + interval '3 hours 30 minutes'), tests.id(p_name)
  );

  insert into public.booking_events (tenant_id, booking_id, event, to_status, actor_kind)
  values (v_tenant_id, tests.id(p_name), 'created', p_status, 'system');
end;
$$;

-- Two businesses. In business A: an owner, a dispatcher, two crews with one cleaner each, a client with a
-- portal login and one without. Crew A1 has jobs tomorrow, in three weeks and two weeks ago, so the
-- cleaner's need-to-know window can be tested from both sides.
create or replace function tests.load_fixture() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform tests.create_user(tests.id(u.name), u.email)
  from (values
    ('a_owner', 'owner@alpha.test'), ('a_dispatcher', 'dispatch@alpha.test'),
    ('a_cleaner1', 'cleaner1@alpha.test'), ('a_cleaner2', 'cleaner2@alpha.test'),
    ('a_client', 'casey@alpha.test'), ('b_owner', 'owner@beta.test'), ('b_client', 'blake@beta.test')
  ) as u (name, email);

  insert into public.tenants (id, slug, name, timezone) values
    (tests.id('tenant_a'), 'alpha-cleaning-test', 'Alpha Cleaning (test)', 'America/New_York'),
    (tests.id('tenant_b'), 'beta-cleaning-test', 'Beta Cleaning (test)', 'America/Chicago');

  insert into public.memberships (tenant_id, user_id, role) values
    (tests.id('tenant_a'), tests.id('a_owner'), 'owner'),
    (tests.id('tenant_a'), tests.id('a_dispatcher'), 'dispatcher'),
    (tests.id('tenant_a'), tests.id('a_cleaner1'), 'cleaner'),
    (tests.id('tenant_a'), tests.id('a_cleaner2'), 'cleaner'),
    (tests.id('tenant_b'), tests.id('b_owner'), 'owner');

  insert into public.crews (id, tenant_id, name) values
    (tests.id('crew_a1'), tests.id('tenant_a'), 'Crew 1'),
    (tests.id('crew_a2'), tests.id('tenant_a'), 'Crew 2'),
    (tests.id('crew_b1'), tests.id('tenant_b'), 'Crew 1');

  insert into public.crew_members (tenant_id, crew_id, user_id) values
    (tests.id('tenant_a'), tests.id('crew_a1'), tests.id('a_cleaner1')),
    (tests.id('tenant_a'), tests.id('crew_a2'), tests.id('a_cleaner2'));

  insert into public.services (id, tenant_id, code, name, booking_mode) values
    (tests.id('service_a'), tests.id('tenant_a'), 'standard', 'Standard clean', 'instant'),
    (tests.id('service_b'), tests.id('tenant_b'), 'standard', 'Standard clean', 'instant');

  insert into public.rule_versions (id, tenant_id, kind, version, rules) values
    (tests.id('pricing_a'), tests.id('tenant_a'), 'pricing', 1, '{}'),
    (tests.id('schedule_a'), tests.id('tenant_a'), 'schedule', 1, '{}'),
    (tests.id('cancellation_a'), tests.id('tenant_a'), 'cancellation', 1, '{}'),
    (tests.id('pricing_b'), tests.id('tenant_b'), 'pricing', 1, '{}'),
    (tests.id('cancellation_b'), tests.id('tenant_b'), 'cancellation', 1, '{}');

  insert into public.clients (id, tenant_id, user_id, full_name, email, source) values
    (tests.id('client_1'), tests.id('tenant_a'), tests.id('a_client'), 'Casey Client', 'casey@alpha.test', 'web'),
    (tests.id('client_2'), tests.id('tenant_a'), null, 'Drew Doe', 'drew@alpha.test', 'web'),
    (tests.id('client_b'), tests.id('tenant_b'), tests.id('b_client'), 'Blake Beta', 'blake@beta.test', 'web');

  insert into public.client_notes (tenant_id, client_id, body) values
    (tests.id('tenant_a'), tests.id('client_1'), 'Prefers morning visits'),
    (tests.id('tenant_b'), tests.id('client_b'), 'Gate code changes monthly');

  insert into public.properties (
    id, tenant_id, client_id, address_line1, city, state, zip, bedrooms, full_baths, access_notes
  ) values
    (tests.id('property_1'), tests.id('tenant_a'), tests.id('client_1'), '1 Elm St', 'Raleigh', 'NC', '27601', 2, 1, 'Lockbox 1111'),
    (tests.id('property_2'), tests.id('tenant_a'), tests.id('client_2'), '2 Oak St', 'Raleigh', 'NC', '27603', 3, 2, 'Lockbox 2222'),
    (tests.id('property_4'), tests.id('tenant_a'), tests.id('client_2'), '4 Pine St', 'Raleigh', 'NC', '27604', 3, 2, 'Gate 4444'),
    (tests.id('property_5'), tests.id('tenant_a'), tests.id('client_2'), '5 Birch St', 'Raleigh', 'NC', '27605', 1, 1, 'Gate 5555'),
    (tests.id('property_b'), tests.id('tenant_b'), tests.id('client_b'), '3 Beta Rd', 'Austin', 'TX', '73301', 2, 2, 'Door code 3333');

  perform tests.add_booking('booking_1', 'tenant_a', 'client_1', 'property_1', 'crew_a1', 'confirmed', tests.tomorrow());
  perform tests.add_booking('booking_2', 'tenant_a', 'client_2', 'property_2', 'crew_a2', 'confirmed', tests.tomorrow());
  perform tests.add_booking('booking_3', 'tenant_a', 'client_2', 'property_4', 'crew_a1', 'confirmed', tests.tomorrow() + interval '21 days');
  perform tests.add_booking('booking_4', 'tenant_a', 'client_2', 'property_5', 'crew_a1', 'completed', tests.tomorrow() - interval '15 days');
  perform tests.add_booking('booking_b', 'tenant_b', 'client_b', 'property_b', 'crew_b1', 'confirmed', tests.tomorrow());
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

select plan(1);
select pass('test helpers installed');
select * from finish();
