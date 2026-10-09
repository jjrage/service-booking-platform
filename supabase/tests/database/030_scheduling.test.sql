-- The double-booking guard and the booking commands.
begin;
select plan(30);

select tests.load_fixture();

-- Exclusion constraint ----------------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.crew_allocations (tenant_id, crew_id, kind, busy)
     values (tests.id('tenant_a'), tests.id('crew_a1'), 'time_off',
             tstzrange(tests.tomorrow() + interval '30 minutes', tests.tomorrow() + interval '2 hours')) $$,
  '23P01', null,
  'a crew cannot have two overlapping allocations'
);

select lives_ok(
  $$ insert into public.crew_allocations (tenant_id, crew_id, kind, busy)
     select tests.id('tenant_a'), tests.id('crew_a1'), 'time_off',
            tstzrange(upper(a.busy), upper(a.busy) + interval '1 hour')
     from public.crew_allocations a where a.booking_id = tests.id('booking_1') $$,
  'an allocation may start exactly when the previous one ends'
);

select lives_ok(
  $$ select public.cmd_add_time_off(tests.id('tenant_a'), tests.id('a_dispatcher'), tests.id('crew_a1'),
       tstzrange(tests.tomorrow() + interval '5 days', tests.tomorrow() + interval '5 days 8 hours'), 'Dentist') $$,
  'a dispatcher can add time off for a crew'
);

select throws_ok(
  $$ select * from public.cmd_hold_slot(tests.id('tenant_a'), array[tests.id('crew_a1')],
       tstzrange(tests.tomorrow() + interval '5 days 2 hours', tests.tomorrow() + interval '5 days 5 hours'), 10) $$,
  '23P01', null,
  'time cannot be held while the crew is off'
);

-- Holds: first free candidate wins ------------------------------------------------------------------------

select throws_ok(
  $$ select * from public.cmd_hold_slot(tests.id('tenant_a'), array[tests.id('crew_a1'), tests.id('crew_a2')],
       tstzrange(tests.tomorrow() + interval '30 minutes', tests.tomorrow() + interval '3 hours'), 10) $$,
  '23P01', null,
  'a hold fails when every candidate crew is busy'
);

create temp table t_hold_1 as
select * from public.cmd_hold_slot(tests.id('tenant_a'), array[tests.id('crew_a1'), tests.id('crew_a2')],
  tstzrange(tests.tomorrow() + interval '2 days', tests.tomorrow() + interval '2 days 3 hours 30 minutes'), 10);
create temp table t_hold_2 as
select * from public.cmd_hold_slot(tests.id('tenant_a'), array[tests.id('crew_a1'), tests.id('crew_a2')],
  tstzrange(tests.tomorrow() + interval '2 days', tests.tomorrow() + interval '2 days 3 hours 30 minutes'), 10);

select is((select crew_id from t_hold_1), tests.id('crew_a1'), 'the first hold takes the preferred crew');
select is((select crew_id from t_hold_2), tests.id('crew_a2'), 'the second hold for the same time takes the next crew');

select throws_ok(
  $$ select * from public.cmd_hold_slot(tests.id('tenant_a'), array[tests.id('crew_a1'), tests.id('crew_a2')],
       tstzrange(tests.tomorrow() + interval '2 days', tests.tomorrow() + interval '2 days 3 hours 30 minutes'), 10) $$,
  '23P01', null,
  'a third hold for the same time fails: both crews are held'
);

select throws_ok(
  $$ select * from public.cmd_hold_slot(tests.id('tenant_a'), array[tests.id('crew_b1')],
       tstzrange(tests.tomorrow() + interval '3 days', tests.tomorrow() + interval '3 days 3 hours'), 10) $$,
  '22023', null,
  'a crew of another business cannot be held'
);

-- An expired hold no longer blocks the time.
insert into public.crew_allocations (tenant_id, crew_id, kind, busy, hold_token, hold_expires_at)
values (tests.id('tenant_a'), tests.id('crew_a1'), 'hold',
        tstzrange(tests.tomorrow() + interval '4 days', tests.tomorrow() + interval '4 days 3 hours'),
        gen_random_uuid(), now() - interval '1 minute');

select is(
  (select crew_id from public.cmd_hold_slot(tests.id('tenant_a'), array[tests.id('crew_a1')],
     tstzrange(tests.tomorrow() + interval '4 days', tests.tomorrow() + interval '4 days 3 hours'), 10)),
  tests.id('crew_a1'),
  'an expired hold does not block a new hold of the same time'
);

-- Guest checkout: hold -> booking ------------------------------------------------------------------------

create temp table t_booking as
select * from public.cmd_create_booking(
  p_tenant_id => tests.id('tenant_a'),
  p_actor => null,
  p_actor_kind => 'guest',
  p_source => 'web',
  p_status => 'pending_payment',
  p_client => '{"full_name": "Morgan Guest", "email": "morgan@example.com", "phone": "919-555-0142"}',
  p_property => '{"address_line1": "7 Maple Ct", "city": "Raleigh", "state": "NC", "zip": "27606",
                  "bedrooms": 3, "full_baths": 2, "access_notes": "Key under the mat"}',
  p_service_id => tests.id('service_a'),
  p_arrival_window => tstzrange(tests.tomorrow() + interval '2 days', tests.tomorrow() + interval '2 days 1 hour'),
  p_busy => tstzrange(tests.tomorrow() + interval '2 days', tests.tomorrow() + interval '2 days 3 hours 30 minutes'),
  p_duration_minutes => 120,
  p_quote => '{"total_cents": 18500}',
  p_total_cents => 18500,
  p_deposit_cents => 5000,
  p_pricing_version_id => tests.id('pricing_a'),
  p_cancellation_version_id => tests.id('cancellation_a'),
  p_hold_token => (select hold_token from t_hold_1),
  p_payment_due_by => now() + interval '30 minutes'
);

select is(
  (select a.kind from public.crew_allocations a where a.booking_id = (select booking_id from t_booking)),
  'booking'::public.allocation_kind,
  'checkout turns the hold into the booking''s allocation'
);
select is((select crew_id from t_booking), tests.id('crew_a1'), 'the booking keeps the held crew');
select is(
  (select c.email::text from public.clients c where c.id = (select client_id from t_booking)),
  'morgan@example.com',
  'a new client is created from the guest''s details'
);
select is(
  (select e.event from public.booking_events e where e.booking_id = (select booking_id from t_booking)),
  'created'::public.booking_event_type,
  'the booking''s creation is recorded in its history'
);

select throws_ok(
  $$ select * from public.cmd_create_booking(
       tests.id('tenant_a'), null, 'guest', 'web', 'pending_payment',
       '{"full_name": "Late Guest", "email": "late@example.com"}',
       '{"address_line1": "9 Cedar Ln", "city": "Raleigh", "state": "NC", "zip": "27606", "bedrooms": 1, "full_baths": 1}',
       tests.id('service_a'),
       tstzrange(tests.tomorrow() + interval '6 days', tests.tomorrow() + interval '6 days 1 hour'),
       tstzrange(tests.tomorrow() + interval '6 days', tests.tomorrow() + interval '6 days 3 hours'),
       120, '{}', 15000, 5000, tests.id('pricing_a'), tests.id('cancellation_a'),
       gen_random_uuid(), null, now() + interval '30 minutes') $$,
  'BK001', null,
  'checkout with an unknown or expired hold is refused'
);

select throws_ok(
  $$ select * from public.cmd_create_booking(
       tests.id('tenant_a'), tests.id('a_client'), 'client', 'portal', 'confirmed',
       jsonb_build_object('id', tests.id('client_1')), jsonb_build_object('id', tests.id('property_1')),
       tests.id('service_a'),
       tstzrange(tests.tomorrow() + interval '7 days', tests.tomorrow() + interval '7 days 1 hour'),
       tstzrange(tests.tomorrow() + interval '7 days', tests.tomorrow() + interval '7 days 3 hours'),
       120, '{}', 15000, 5000, tests.id('pricing_a'), tests.id('cancellation_a'),
       null, array[tests.id('crew_a1')]) $$,
  '42501', null,
  'a client cannot create a booking that skips the deposit'
);

-- Tenant consistency ---------------------------------------------------------------------------------------

select throws_ok(
  $$ update public.bookings set property_id = tests.id('property_b') where id = tests.id('booking_2') $$,
  '23503', null,
  'a booking cannot point at another business''s property'
);
select throws_ok(
  $$ update public.bookings set property_id = tests.id('property_1') where id = tests.id('booking_2') $$,
  '23503', null,
  'a booking cannot point at another client''s home'
);

-- Reassign, reschedule, cancel ------------------------------------------------------------------------------

select throws_ok(
  $$ select public.cmd_reassign_booking(tests.id('booking_2'), tests.id('a_dispatcher'), tests.id('crew_a1')) $$,
  '23P01', null,
  'reassigning to a crew that is busy at that time is rejected by the database'
);

select lives_ok(
  $$ select public.cmd_reassign_booking(tests.id('booking_3'), tests.id('a_dispatcher'), tests.id('crew_a2')) $$,
  'reassigning to a free crew works'
);
select is(
  (select a.crew_id from public.crew_allocations a where a.booking_id = tests.id('booking_3')),
  tests.id('crew_a2'),
  'the allocation follows the booking to its new crew'
);

select throws_ok(
  $$ select public.cmd_reassign_booking(tests.id('booking_2'), tests.id('a_cleaner1'), tests.id('crew_a1')) $$,
  '42501', null,
  'a cleaner cannot reassign bookings'
);

select throws_ok(
  $$ select * from public.cmd_reschedule_booking(tests.id('booking_2'), null, 'guest',
       tstzrange(tests.tomorrow() + interval '8 days', tests.tomorrow() + interval '8 days 1 hour'),
       tstzrange(tests.tomorrow() + interval '8 days', tests.tomorrow() + interval '8 days 3 hours'),
       array[tests.id('crew_a2')]) $$,
  '42501', null,
  'a guest cannot reschedule a booking'
);

select lives_ok(
  $$ select * from public.cmd_reschedule_booking(tests.id('booking_2'), tests.id('a_dispatcher'), 'staff',
       tstzrange(tests.tomorrow() + interval '8 days', tests.tomorrow() + interval '8 days 1 hour'),
       tstzrange(tests.tomorrow() + interval '8 days', tests.tomorrow() + interval '8 days 3 hours 30 minutes'),
       array[tests.id('crew_a2')]) $$,
  'a dispatcher can reschedule a booking'
);
select is(
  (select lower(a.busy) from public.crew_allocations a where a.booking_id = tests.id('booking_2')),
  tests.tomorrow() + interval '8 days',
  'rescheduling moves the crew''s time with the booking'
);

select throws_ok(
  $$ select public.cmd_cancel_booking(tests.id('booking_2'), tests.id('a_client'), 'client', 'Not mine', 0) $$,
  '42501', null,
  'a client cannot cancel someone else''s booking'
);

select lives_ok(
  $$ select public.cmd_cancel_booking(tests.id('booking_1'), tests.id('a_client'), 'client', 'Travelling', 4000) $$,
  'a client can cancel their own booking'
);
select is(
  (select count(*)::int from public.crew_allocations a where a.booking_id = tests.id('booking_1')),
  0,
  'cancelling frees the crew''s time'
);

-- Scheduled expiry and append-only history ----------------------------------------------------------------

update public.bookings set payment_due_by = now() - interval '1 minute'
where id = (select booking_id from t_booking);
select public.cmd_expire_stale();

select is(
  (select b.status from public.bookings b where b.id = (select booking_id from t_booking)),
  'expired'::public.booking_status,
  'an unpaid booking expires after its payment window'
);

select throws_ok(
  $$ update public.rule_versions set rules = '{"changed": true}' where id = tests.id('pricing_a') $$,
  '42501', null,
  'a published rule version cannot be edited'
);

select * from finish();
rollback;
