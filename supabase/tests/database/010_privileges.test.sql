-- Deny by default: the browser-facing roles can read only what policies allow and can change nothing.
begin;
select plan(8);

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'every table in public has row-level security enabled'
);

select is(
  (select count(*)::int
   from pg_tables t
   cross join unnest(array['anon', 'authenticated']) as r (role_name)
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p (privilege)
   where t.schemaname = 'public'
     and has_table_privilege(r.role_name, format('public.%I', t.tablename), p.privilege)),
  0,
  'anon and authenticated cannot insert, update, delete or truncate any table'
);

select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'cmd\_%'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0,
  'no command function is executable by anon or authenticated'
);

select ok(
  (select count(*) >= 10 and bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'cmd\_%'),
  'the service role can execute every command function'
);

select ok(
  has_function_privilege('anon', 'public.public_busy(uuid, timestamptz, timestamptz)', 'EXECUTE'),
  'anon can read crew busy ranges for the public booking page'
);

-- A table or function added by a future migration is not exposed by accident.
create table public.zz_probe (id integer);
create function public.zz_probe_fn() returns integer language sql as 'select 1';

select ok(
  not has_table_privilege('anon', 'public.zz_probe', 'SELECT')
  and not has_table_privilege('authenticated', 'public.zz_probe', 'SELECT'),
  'new tables are not readable by default'
);

select ok(
  not has_function_privilege('anon', 'public.zz_probe_fn()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.zz_probe_fn()', 'EXECUTE'),
  'new functions are not executable by default'
);

select tests.load_fixture();
select tests.authenticate_as(tests.id('a_owner'));
select throws_ok(
  $$ select public.cmd_expire_stale() $$,
  '42501',
  null,
  'a signed-in owner still cannot call a command function directly'
);
select tests.clear_authentication();

select * from finish();
rollback;
