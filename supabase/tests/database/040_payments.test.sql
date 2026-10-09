-- Payments: who sees what, idempotent provider events, booking confirmation, refunds.
begin;
select plan(24);

select tests.load_fixture();

-- A guest's booking waiting for its deposit (client_2, crew A2, the day after tomorrow).
create temporary table pending on commit drop as
select * from public.cmd_create_booking(
  tests.id('tenant_a'), null, 'guest', 'web', 'pending_payment',
  jsonb_build_object('id', tests.id('client_2')), jsonb_build_object('id', tests.id('property_2')),
  tests.id('service_a'),
  tstzrange(tests.tomorrow() + interval '1 day', tests.tomorrow() + interval '1 day 1 hour'),
  tstzrange(tests.tomorrow() + interval '1 day', tests.tomorrow() + interval '1 day 3 hours'),
  120, '{}', 20000, 5000, tests.id('pricing_a'), tests.id('cancellation_a'),
  null, array[tests.id('crew_a2')], now() + interval '30 minutes'
);

select public.cmd_save_billing(tests.id('tenant_a'), tests.id('client_2'), 'simulated', 'sim_cus_2');

select isnt(
  public.cmd_start_payment((select booking_id from pending), 'deposit', 5000, 'simulated', 'sim_pi_deposit'),
  null,
  'a deposit is recorded for a booking waiting for payment'
);
select is(
  public.cmd_start_payment((select booking_id from pending), 'deposit', 5000, 'simulated', 'sim_pi_deposit'),
  (select id from public.payments where provider_payment_id = 'sim_pi_deposit'),
  'recording the same provider payment again returns the same row'
);
select throws_ok(
  format($$ select public.cmd_start_payment(%L, 'deposit', 5000, 'simulated', 'sim_pi_other') $$,
         tests.id('booking_1')),
  'BK002',
  null,
  'a confirmed booking does not take a deposit'
);
select throws_ok(
  $$ select public.cmd_start_payment((select booking_id from pending), 'balance', 20001, 'simulated', 'sim_pi_x') $$,
  '22023',
  null,
  'a payment cannot exceed the booking total'
);

-- Events -------------------------------------------------------------------------------------------------

select is(
  (select applied from public.cmd_apply_payment_event('simulated', 'evt_unknown', 'payment_intent.succeeded',
     'sim_pi_not_ours', 'succeeded')),
  false,
  'an event for a payment this app never recorded is ignored'
);
select is(
  (select count(*)::int from public.payment_events where event_id = 'evt_unknown'),
  0,
  '... and not recorded, so nothing is lost if it was merely early'
);

select is(
  (select row(applied, payment_status, booking_status)::text
   from public.cmd_apply_payment_event('simulated', 'evt_1', 'payment_intent.payment_failed', 'sim_pi_deposit',
     'failed', 'card_declined', 'Your card was declined.')),
  '(t,failed,pending_payment)',
  'a declined deposit leaves the booking waiting for payment'
);
select is(
  (select row(applied, payment_status, booking_status)::text
   from public.cmd_apply_payment_event('simulated', 'evt_2', 'payment_intent.succeeded', 'sim_pi_deposit',
     'succeeded', null, null,
     '{"payment_method_ref": "sim_pm_4242", "brand": "visa", "last4": "4242", "exp_month": 12, "exp_year": 2030}')),
  '(t,succeeded,confirmed)',
  'a retried deposit that succeeds confirms the booking'
);
select is(
  (select row(status, payment_due_by is null)::text from public.bookings where id = (select booking_id from pending)),
  '(confirmed,t)',
  'the confirmed booking no longer has a payment deadline'
);
select is(
  (select card_last4 from public.client_billing where client_id = tests.id('client_2')),
  '4242',
  'the card used is saved for later off-session charges'
);
select is(
  (select array_agg(event::text order by id) from public.booking_events
   where booking_id = (select booking_id from pending)),
  array['created', 'payment_failed', 'confirmed', 'payment_received'],
  'the booking history shows the failure, the confirmation and the payment'
);

select is(
  (select applied from public.cmd_apply_payment_event('simulated', 'evt_2', 'payment_intent.succeeded',
     'sim_pi_deposit', 'succeeded')),
  false,
  'a redelivered event is not applied again'
);
select is(
  (select count(*)::int from public.booking_events where booking_id = (select booking_id from pending)),
  4,
  '... and adds nothing to the history'
);
select is(
  (select payment_status from public.cmd_apply_payment_event('simulated', 'evt_3', 'payment_intent.payment_failed',
     'sim_pi_deposit', 'failed', 'expired_card')),
  'succeeded',
  'a late failure event cannot undo a succeeded payment'
);

-- An off-session balance that fails raises an alert for the office.
select public.cmd_start_payment((select booking_id from pending), 'balance', 15000, 'simulated', 'sim_pi_balance', true);
select public.cmd_apply_payment_event('simulated', 'evt_4', 'payment_intent.payment_failed', 'sim_pi_balance',
  'failed', 'card_declined');
select is(
  (select count(*)::int from public.dispatch_alerts
   where booking_id = (select booking_id from pending) and kind = 'payment_failed' and resolved_at is null),
  1,
  'a declined off-session charge puts the booking in the dispatcher''s queue'
);

-- A deposit that arrives after the booking expired.
update public.bookings set status = 'pending_payment', payment_due_by = now() + interval '1 minute'
where id = tests.id('booking_2');
select public.cmd_start_payment(tests.id('booking_2'), 'deposit', 5000, 'simulated', 'sim_pi_late');
update public.bookings set payment_due_by = now() - interval '1 minute' where id = tests.id('booking_2');
select public.cmd_expire_stale();
select is(
  (select booking_status from public.cmd_apply_payment_event('simulated', 'evt_5', 'payment_intent.succeeded',
     'sim_pi_late', 'succeeded')),
  'expired',
  'a deposit paid after the deadline does not revive an expired booking'
);
select is(
  (select count(*)::int from public.dispatch_alerts where booking_id = tests.id('booking_2')),
  1,
  '... it is flagged for a refund or a rebooking instead'
);

-- Refunds ------------------------------------------------------------------------------------------------

select isnt(
  public.cmd_record_refund((select id from public.payments where provider_payment_id = 'sim_pi_deposit'),
    tests.id('a_owner'), 'staff', 3000, 'Goodwill', 'sim_re_1', 'succeeded'),
  null,
  'staff can refund part of a payment'
);
select throws_ok(
  format($$ select public.cmd_record_refund(%L, %L, 'staff', 2001, 'Too much', 'sim_re_2', 'succeeded') $$,
         (select id from public.payments where provider_payment_id = 'sim_pi_deposit'), tests.id('a_owner')),
  '22023',
  null,
  'refunds never add up to more than the payment'
);
select throws_ok(
  format($$ select public.cmd_record_refund(%L, %L, 'staff', 100, 'Not mine', 'sim_re_3', 'succeeded') $$,
         (select id from public.payments where provider_payment_id = 'sim_pi_deposit'), tests.id('a_cleaner1')),
  '42501',
  null,
  'a cleaner cannot issue refunds'
);

-- Visibility ---------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('a_owner'));
select is((select count(*)::int from public.payments), 3, 'the owner sees every payment of the business');
select tests.authenticate_as(tests.id('a_cleaner2'));
select is((select count(*)::int from public.payments) + (select count(*)::int from public.client_billing), 0,
  'a cleaner sees no payments or saved cards');
select tests.authenticate_as(tests.id('a_client'));
select is((select count(*)::int from public.payments), 0, 'a client does not see another client''s payments');
select tests.authenticate_as(tests.id('b_owner'));
select is((select count(*)::int from public.payments) + (select count(*)::int from public.refunds), 0,
  'another business sees none of these payments or refunds');
select tests.clear_authentication();

select * from finish();
rollback;
