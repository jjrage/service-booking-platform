-- Who sees what: tenant isolation and role-based visibility.
begin;
select plan(27);

select tests.load_fixture();

-- Owner of business A --------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('a_owner'));

select set_eq(
  $$ select id from public.bookings $$,
  array[tests.id('booking_1'), tests.id('booking_2'), tests.id('booking_3'), tests.id('booking_4')],
  'owner sees every booking of their business'
);
select is((select count(*)::int from public.bookings where tenant_id = tests.id('tenant_b')), 0,
  'owner sees no booking of another business');
select set_eq($$ select id from public.clients $$,
  array[tests.id('client_1'), tests.id('client_2')], 'owner sees only their own clients');
select is((select count(*)::int from public.client_notes), 1, 'owner reads CRM notes of their own clients only');
select is((select count(*)::int from public.properties), 4, 'owner sees every address of their business');
select is((select count(*)::int from public.crew_allocations), 4, 'owner sees the crew calendar of their business');
select is((select count(*)::int from public.booking_events), 4, 'owner sees booking history of their business');

-- Dispatcher ------------------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('a_dispatcher'));

select is((select count(*)::int from public.bookings), 4, 'dispatcher sees every booking of the business');
select is((select count(*)::int from public.client_notes), 1, 'dispatcher reads CRM notes');

-- Cleaner in crew A1 (jobs: tomorrow, in three weeks, two weeks ago) --------------------------------------
select tests.authenticate_as(tests.id('a_cleaner1'));

select set_eq($$ select id from public.bookings $$,
  array[tests.id('booking_1'), tests.id('booking_3'), tests.id('booking_4')],
  'cleaner sees the bookings of their own crew only');
select set_eq($$ select id from public.properties $$, array[tests.id('property_1')],
  'cleaner sees the address of tomorrow''s job');
select is((select count(*)::int from public.properties where id = tests.id('property_4')), 0,
  'cleaner does not see the address of their crew''s job three weeks ahead');
select is((select count(*)::int from public.properties where id = tests.id('property_5')), 0,
  'cleaner does not see the address of their crew''s job two weeks ago');
select is((select count(*)::int from public.properties where id = tests.id('property_2')), 0,
  'cleaner does not see another crew''s addresses');
select set_eq($$ select id from public.clients $$, array[tests.id('client_1')],
  'cleaner sees only the client of an upcoming job');
select is((select count(*)::int from public.client_notes), 0, 'cleaner reads no CRM notes');

-- Cleaner in crew A2 ------------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('a_cleaner2'));

select set_eq($$ select id from public.bookings $$, array[tests.id('booking_2')],
  'the other crew''s cleaner sees only their own job');

-- Client of business A with a portal login --------------------------------------------------------------
select tests.authenticate_as(tests.id('a_client'));

select set_eq($$ select id from public.bookings $$, array[tests.id('booking_1')],
  'client sees only their own bookings');
select set_eq($$ select id from public.properties $$, array[tests.id('property_1')],
  'client sees only their own home');
select set_eq($$ select id from public.clients $$, array[tests.id('client_1')],
  'client sees only their own client record');
select is((select count(*)::int from public.client_notes), 0, 'client cannot read what staff wrote about them');
select is((select count(*)::int from public.crew_allocations), 0, 'client cannot read the crew calendar');
select is((select count(*)::int from public.booking_events), 0, 'client cannot read the staff audit trail');

-- Owner of business B ---------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('b_owner'));

select set_eq($$ select id from public.bookings $$, array[tests.id('booking_b')],
  'another business sees only its own bookings');

-- Anonymous visitor ------------------------------------------------------------------------------------
select tests.authenticate_as_anon();

select throws_ok($$ select count(*) from public.bookings $$, '42501', null,
  'an anonymous visitor cannot read bookings at all');
select is(
  (select count(*)::int from public.tenants where id in (tests.id('tenant_a'), tests.id('tenant_b'))),
  2,
  'an anonymous visitor can read public business profiles'
);
select ok(
  (select count(*) > 0 from public.public_busy(tests.id('tenant_a'), now(), now() + interval '30 days')),
  'an anonymous visitor can read busy ranges for the booking page'
);

select tests.clear_authentication();

select * from finish();
rollback;
