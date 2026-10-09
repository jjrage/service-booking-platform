-- Operations: who may finish a job, and the job-photo storage policies.
begin;
select plan(9);

select tests.load_fixture();

-- booking_1 is crew A1's job tomorrow; make it today (2 hours ago) so it can be finished.
update public.bookings set arrival_window = tstzrange(now() - interval '2 hours', now() - interval '1 hour')
where id = tests.id('booking_1');
update public.crew_allocations set busy = tstzrange(now() - interval '2 hours', now() + interval '2 hours')
where booking_id = tests.id('booking_1');

select throws_ok(
  format($$ select public.cmd_complete_job(%L, %L, '[]', '', '{}') $$, tests.id('booking_1'), tests.id('a_cleaner2')),
  '42501',
  null,
  'a cleaner of another crew cannot complete the job'
);
select throws_ok(
  format($$ select public.cmd_complete_job(%L, %L, '[]', '', '{}') $$, tests.id('booking_1'), tests.id('a_client')),
  '42501',
  null,
  'a client cannot complete their own job'
);
select throws_ok(
  format($$ select public.cmd_complete_job(%L, %L, '[]', '', array['%s/%s/x.jpg']) $$,
         tests.id('booking_1'), tests.id('a_cleaner1'), tests.id('tenant_a'), tests.id('booking_2')),
  '22023',
  null,
  'a photo must be stored under the job itself'
);
select lives_ok(
  format($$ select public.cmd_complete_job(%L, %L, '[{"item": "Kitchen", "done": true}]', 'Done', array['%s/%s/a.jpg']) $$,
         tests.id('booking_1'), tests.id('a_cleaner1'), tests.id('tenant_a'), tests.id('booking_1')),
  'the assigned crew completes its job with a photo'
);
select is(
  (select row(b.status, r.notes, (select count(*) from public.job_photos p where p.booking_id = b.id))::text
   from public.bookings b join public.job_reports r on r.booking_id = b.id where b.id = tests.id('booking_1')),
  '(completed,Done,1)',
  'the booking is completed with its report and photo'
);

-- Storage policies ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('a_cleaner2'));
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('job-photos', '%s/%s/p1.jpg', %L) $$,
         tests.id('tenant_a'), tests.id('booking_2'), tests.id('a_cleaner2')),
  'a cleaner uploads a photo under a job of their own crew'
);
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('job-photos', '%s/%s/p2.jpg', %L) $$,
         tests.id('tenant_a'), tests.id('booking_1'), tests.id('a_cleaner2')),
  '42501',
  null,
  '... but not under another crew''s job'
);
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('job-photos', '%s/%s/p3.jpg', %L) $$,
         tests.id('tenant_a'), tests.id('booking_3'), tests.id('a_cleaner2')),
  '42501',
  null,
  '... nor under any job it cannot see (another crew, three weeks out)'
);
select tests.authenticate_as(tests.id('b_owner'));
select is(
  (select count(*)::int from storage.objects where bucket_id = 'job-photos'),
  0,
  'another business sees none of the photos'
);
select tests.clear_authentication();

select * from finish();
rollback;
