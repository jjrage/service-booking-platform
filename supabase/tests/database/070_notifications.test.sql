-- Outbox: messages queued with the change that caused them, reminders follow a reschedule, delivery happens once.
begin;
select plan(11);

select tests.load_fixture();
update public.clients set phone = '(919) 555-0100' where id = tests.id('client_1');

-- A staff booking five days ahead, confirmed on creation (crew A2 is free then).
create temporary table visit on commit drop as
select * from public.cmd_create_booking(
  tests.id('tenant_a'), tests.id('a_dispatcher'), 'staff', 'admin', 'confirmed',
  jsonb_build_object('id', tests.id('client_1')), jsonb_build_object('id', tests.id('property_1')),
  tests.id('service_a'),
  tstzrange(tests.tomorrow() + interval '4 days', tests.tomorrow() + interval '4 days 1 hour'),
  tstzrange(tests.tomorrow() + interval '4 days', tests.tomorrow() + interval '4 days 3 hours'),
  120, '{}', 20000, 0, tests.id('pricing_a'), tests.id('cancellation_a'),
  null, array[tests.id('crew_a2')]
);

select is(
  (select array_agg(kind || '/' || channel order by kind, channel) from public.outbox
   where booking_id = (select booking_id from visit)),
  array['booking_confirmed/email', 'reminder_24h/email', 'reminder_24h/sms_log', 'reminder_72h/email'],
  'a confirmed booking queues its confirmation, both reminders and the reminder text (logged only)'
);
select is(
  (select to_address from public.outbox where booking_id = (select booking_id from visit) and channel = 'email' limit 1),
  'casey@alpha.test',
  'messages go to the client''s e-mail'
);

-- Reschedule two days later: the old reminders are cancelled and new ones follow the new window.
select public.cmd_reschedule_booking(
  (select booking_id from visit), tests.id('a_dispatcher'), 'staff',
  tstzrange(tests.tomorrow() + interval '6 days', tests.tomorrow() + interval '6 days 1 hour'),
  tstzrange(tests.tomorrow() + interval '6 days', tests.tomorrow() + interval '6 days 3 hours'),
  array[tests.id('crew_a2')]
);
select is(
  (select count(*)::int from public.outbox
   where booking_id = (select booking_id from visit) and kind like 'reminder%' and status = 'cancelled'),
  3,
  'rescheduling cancels the pending reminders for the old window'
);
select is(
  (select count(*)::int from public.outbox
   where booking_id = (select booking_id from visit) and kind like 'reminder%' and status = 'pending'
     and send_after >= tests.tomorrow() + interval '3 days'),
  3,
  '... and queues reminders for the new window'
);
select is(
  (select count(*)::int from public.outbox where booking_id = (select booking_id from visit) and kind = 'booking_rescheduled'),
  1,
  '... and tells the client about the new time'
);

-- Delivery ------------------------------------------------------------------------------------------------

create temporary table claimed on commit drop as
select * from public.cmd_claim_outbox(100) where booking_id = (select booking_id from visit);
select ok(
  (select count(*) from claimed where kind = 'booking_confirmed') = 1
  and not exists (select 1 from claimed where kind like 'reminder%'),
  'the sender claims messages that are due, not future reminders'
);
select is(
  (select count(*)::int from public.cmd_claim_outbox(50)),
  0,
  'a second sender running at the same time gets nothing already claimed'
);
select is(
  public.cmd_finish_outbox((select id from claimed where kind = 'booking_confirmed'), true, 'log', 'log_1', null, 'Confirmed', '<p>hi</p>', 'hi'),
  'sent',
  'a delivered message is marked sent'
);
select is(
  public.cmd_finish_outbox((select id from claimed where kind = 'booking_confirmed'), true, 'log', 'log_2', null, null, null, null),
  'sent',
  'finishing it again changes nothing (no second delivery recorded)'
);
select is(
  public.cmd_finish_outbox((select id from claimed where kind = 'booking_rescheduled'), false, 'resend', null, 'timeout', null, null, null),
  'pending',
  'a failed delivery goes back to the queue with a delay'
);

select tests.authenticate_as(tests.id('a_client'));
select is((select count(*)::int from public.outbox), 0, 'clients do not read the outbox');
select tests.clear_authentication();

select * from finish();
rollback;
