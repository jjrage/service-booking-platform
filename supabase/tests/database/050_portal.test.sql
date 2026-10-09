-- Client portal commands: who may change what, account linking, plans that start themselves, pausing.
begin;
select plan(10);

select tests.load_fixture();

-- Profile and home notes ---------------------------------------------------------------------------------

select lives_ok(
  format($$ select public.cmd_update_property_notes(%L, %L, 'client', true, 'Cat', 'Code 9', '') $$,
         tests.id('property_1'), tests.id('a_client')),
  'a client updates the notes of their own home'
);
select throws_ok(
  format($$ select public.cmd_update_property_notes(%L, %L, 'client', true, 'x', 'x', 'x') $$,
         tests.id('property_2'), tests.id('a_client')),
  '42501',
  null,
  'a client cannot change another client''s home'
);
select throws_ok(
  format($$ select public.cmd_update_client_contact(%L, %L, 'staff', 'Drew', null) $$,
         tests.id('client_2'), tests.id('a_cleaner1')),
  '42501',
  null,
  'a cleaner cannot edit client records'
);

-- Account linking ------------------------------------------------------------------------------------------

select tests.create_user('a9000000-0000-4000-8000-000000000001', 'drew@alpha.test');
select is(
  public.cmd_link_client_account('a9000000-0000-4000-8000-000000000001', 'DREW@alpha.test'),
  1,
  'a verified e-mail links the user to the client record with that address (case-insensitive)'
);
select is(
  public.cmd_link_client_account('a9000000-0000-4000-8000-000000000001', 'drew@alpha.test'),
  0,
  'linking again changes nothing'
);

-- A plan starts when its first visit is confirmed -------------------------------------------------------

create temporary table first_visit on commit drop as
select * from public.cmd_create_booking(
  tests.id('tenant_a'), null, 'guest', 'web', 'pending_payment',
  jsonb_build_object('id', tests.id('client_2')), jsonb_build_object('id', tests.id('property_4')),
  tests.id('service_a'),
  tstzrange(tests.tomorrow() + interval '3 days', tests.tomorrow() + interval '3 days 1 hour'),
  tstzrange(tests.tomorrow() + interval '3 days', tests.tomorrow() + interval '3 days 3 hours'),
  120, '{"frequency": "weekly", "recurringVisit": {"service": "standard", "totalCents": 17000, "durationMinutes": 120}}',
  20000, 0, tests.id('pricing_a'), tests.id('cancellation_a'),
  null, array[tests.id('crew_a2')], now() + interval '30 minutes'
);
select public.cmd_start_payment((select booking_id from first_visit), 'card_setup', 0, 'simulated', 'sim_seti_plan');
select public.cmd_apply_payment_event('simulated', 'evt_plan', 'setup_intent.succeeded', 'sim_seti_plan', 'succeeded');

select is(
  (select row(p.frequency, p.price_cents, p.status, p.preferred_crew_id = tests.id('crew_a2'))::text
   from public.bookings b join public.recurring_plans p on p.id = b.recurring_plan_id
   where b.id = (select booking_id from first_visit)),
  '(weekly,17000,active,t)',
  'confirming the first visit starts a weekly plan at the regular price with the same crew'
);

-- Pausing --------------------------------------------------------------------------------------------------

select public.cmd_create_booking(
  tests.id('tenant_a'), null, 'system', 'plan', 'confirmed',
  jsonb_build_object('id', tests.id('client_2')), jsonb_build_object('id', tests.id('property_4')),
  tests.id('service_a'),
  tstzrange(tests.tomorrow() + interval '10 days', tests.tomorrow() + interval '10 days 1 hour'),
  tstzrange(tests.tomorrow() + interval '10 days', tests.tomorrow() + interval '10 days 3 hours'),
  120, '{}', 17000, 0, tests.id('pricing_a'), tests.id('cancellation_a'),
  null, array[tests.id('crew_a2')], null,
  (select recurring_plan_id from public.bookings where id = (select booking_id from first_visit)),
  (current_date + 11)
);

select throws_ok(
  format($$ select public.cmd_pause_plan(%L, %L, 'client', current_date + 30, now() + interval '48 hours') $$,
         (select recurring_plan_id from public.bookings where id = (select booking_id from first_visit)),
         tests.id('a_client')),
  '42501',
  null,
  'a client cannot pause another client''s plan'
);
select is(
  public.cmd_pause_plan(
    (select recurring_plan_id from public.bookings where id = (select booking_id from first_visit)),
    null, 'system', current_date + 30, now() + interval '5 days'),
  1,
  'pausing cancels the visits beyond the free-cancellation boundary, not the near one'
);
select is(
  (select array_agg(status::text order by lower(arrival_window)) from public.bookings
   where recurring_plan_id = (select recurring_plan_id from public.bookings where id = (select booking_id from first_visit))),
  array['confirmed', 'cancelled'],
  '... the visit in 4 days stays, the one in 11 days is cancelled'
);
select is(
  (select count(*)::int from public.crew_allocations a
   join public.bookings b on b.id = a.booking_id
   where b.recurring_plan_id = (select recurring_plan_id from public.bookings where id = (select booking_id from first_visit))),
  1,
  '... and its crew time is released'
);

select * from finish();
rollback;
