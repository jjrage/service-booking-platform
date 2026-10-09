-- Operations: job reports and photos from the crew app, the dispatcher's tools (alerts, client notes), and
-- the private photo bucket with storage policies that follow the same rules as the tables.

create table public.job_reports (
  booking_id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  checklist jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array'),
  notes text check (length(notes) <= 2000),
  completed_by uuid,
  completed_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create table public.job_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  booking_id uuid not null,
  -- {tenant_id}/{booking_id}/{file} in the job-photos bucket.
  storage_path text not null unique,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  check (storage_path like tenant_id::text || '/' || booking_id::text || '/%')
);

create index job_photos_booking_idx on public.job_photos (tenant_id, booking_id);

alter table public.job_reports enable row level security;
alter table public.job_photos enable row level security;
grant select on public.job_reports, public.job_photos to authenticated;

-- Staff see every report; a crew sees the reports of its own jobs; a client sees the report of their visit.
create policy job_reports_staff_read on public.job_reports
  for select to authenticated using (private.is_staff(tenant_id));
create policy job_reports_crew_read on public.job_reports
  for select to authenticated
  using (booking_id in (
    select b.id from public.bookings b where b.crew_id in (select private.my_crew_ids())
  ));
create policy job_reports_client_read on public.job_reports
  for select to authenticated
  using (booking_id in (
    select b.id from public.bookings b where b.client_id in (select private.my_client_ids())
  ));

create policy job_photos_staff_read on public.job_photos
  for select to authenticated using (private.is_staff(tenant_id));
create policy job_photos_crew_read on public.job_photos
  for select to authenticated
  using (booking_id in (
    select b.id from public.bookings b where b.crew_id in (select private.my_crew_ids())
  ));
create policy job_photos_client_read on public.job_photos
  for select to authenticated
  using (booking_id in (
    select b.id from public.bookings b where b.client_id in (select private.my_client_ids())
  ));

-- Photo storage ------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- True when the current user's crew has this booking and it is within the crew's need-to-know window
-- (7 days back, 14 days ahead), the same window that lets them see the address.
create function private.crew_can_access_job(p_booking_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.bookings b
    join public.crew_members cm on cm.crew_id = b.crew_id and cm.user_id = (select auth.uid())
    where b.id = p_booking_id
      and upper(b.arrival_window) > now() - interval '7 days'
      and lower(b.arrival_window) < now() + interval '14 days'
  );
$$;

create function private.storage_booking_id(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return (storage.foldername(p_name))[2]::uuid;
exception
  when others then
    return null;
end;
$$;

create function private.storage_tenant_id(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception
  when others then
    return null;
end;
$$;

grant execute on function
  private.crew_can_access_job(uuid), private.storage_booking_id(text), private.storage_tenant_id(text)
to authenticated, service_role;

-- A cleaner uploads and reads photos only under jobs of their own crew; staff read everything of their
-- business; a client reads the photos of their own visits.
create policy job_photos_crew_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and private.crew_can_access_job(private.storage_booking_id(name))
    and private.storage_tenant_id(name) = (
      select b.tenant_id from public.bookings b where b.id = private.storage_booking_id(name)
    )
  );

create policy job_photos_crew_select on storage.objects
  for select to authenticated
  using (bucket_id = 'job-photos' and private.crew_can_access_job(private.storage_booking_id(name)));

create policy job_photos_staff_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and private.is_staff(private.storage_tenant_id(name))
  );

create policy job_photos_client_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and private.storage_booking_id(name) in (
      select b.id from public.bookings b where b.client_id in (select private.my_client_ids())
    )
  );

-- Commands -----------------------------------------------------------------------------------------------

-- A member of the booking's crew (or staff) marks the job done: report, checklist and photos are stored,
-- the booking becomes completed. Charging the balance is the server's next step.
create function public.cmd_complete_job(
  p_booking_id uuid,
  p_actor uuid,
  p_checklist jsonb,
  p_notes text,
  p_photo_paths text[]
) returns void
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
  v_is_staff boolean;
begin
  select * into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;

  v_is_staff := exists (
    select 1 from public.memberships m
    where m.tenant_id = v_booking.tenant_id and m.user_id = p_actor and m.role in ('owner', 'dispatcher')
  );
  if p_actor is null or not (v_is_staff or exists (
    select 1 from public.crew_members cm where cm.crew_id = v_booking.crew_id and cm.user_id = p_actor
  )) then
    raise exception 'only the assigned crew or staff can complete this job' using errcode = 'insufficient_privilege';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'a % booking cannot be completed', v_booking.status using errcode = 'BK002';
  end if;
  if lower(v_booking.arrival_window) > now() + interval '12 hours' then
    raise exception 'a job can be completed on its day, not in advance' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_photo_paths, '{}')) as path
    where path not like v_booking.tenant_id::text || '/' || v_booking.id::text || '/%'
  ) then
    raise exception 'photo is not stored under this job' using errcode = 'invalid_parameter_value';
  end if;

  update public.bookings b set status = 'completed', completed_at = now() where b.id = p_booking_id;

  insert into public.job_reports (booking_id, tenant_id, checklist, notes, completed_by)
  values (p_booking_id, v_booking.tenant_id, coalesce(p_checklist, '[]'), nullif(btrim(p_notes), ''), p_actor);

  insert into public.job_photos (tenant_id, booking_id, storage_path, uploaded_by)
  select v_booking.tenant_id, p_booking_id, path, p_actor
  from unnest(coalesce(p_photo_paths, '{}')) as path
  on conflict (storage_path) do nothing;

  insert into public.booking_events (
    tenant_id, booking_id, event, from_status, to_status, actor_user_id, actor_kind, data
  )
  values (
    v_booking.tenant_id, p_booking_id, 'completed', 'confirmed', 'completed', p_actor,
    case when v_is_staff then 'staff'::public.actor_kind else 'crew'::public.actor_kind end,
    jsonb_build_object('photos', coalesce(cardinality(p_photo_paths), 0))
  );
end;
$$;

-- The crew could not get in. The lockout fee (computed by the server from the booking's rules) is recorded
-- here and charged by the server.
create function public.cmd_mark_no_access(
  p_booking_id uuid,
  p_actor uuid,
  p_note text,
  p_fee_cents bigint
) returns void
language plpgsql set search_path = '' as $$
declare
  v_booking public.bookings;
  v_is_staff boolean;
begin
  select * into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;

  v_is_staff := exists (
    select 1 from public.memberships m
    where m.tenant_id = v_booking.tenant_id and m.user_id = p_actor and m.role in ('owner', 'dispatcher')
  );
  if p_actor is null or not (v_is_staff or exists (
    select 1 from public.crew_members cm where cm.crew_id = v_booking.crew_id and cm.user_id = p_actor
  )) then
    raise exception 'only the assigned crew or staff can report a lockout' using errcode = 'insufficient_privilege';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'a % booking cannot be marked as no access', v_booking.status using errcode = 'BK002';
  end if;
  if lower(v_booking.arrival_window) > now() + interval '12 hours' then
    raise exception 'a lockout is reported on the day of the job' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_fee_cents, -1) < 0 or p_fee_cents > v_booking.total_cents then
    raise exception 'fee must be between zero and the booking total' using errcode = 'invalid_parameter_value';
  end if;

  update public.bookings b set status = 'no_access', completed_at = now() where b.id = p_booking_id;

  insert into public.job_reports (booking_id, tenant_id, notes, completed_by)
  values (p_booking_id, v_booking.tenant_id, nullif(btrim(p_note), ''), p_actor);

  insert into public.booking_events (
    tenant_id, booking_id, event, from_status, to_status, actor_user_id, actor_kind, data
  )
  values (
    v_booking.tenant_id, p_booking_id, 'no_access', 'confirmed', 'no_access', p_actor,
    case when v_is_staff then 'staff'::public.actor_kind else 'crew'::public.actor_kind end,
    jsonb_build_object('note', p_note, 'fee_cents', p_fee_cents)
  );
end;
$$;

create function public.cmd_add_client_note(p_client_id uuid, p_actor uuid, p_body text) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_tenant_id uuid;
  v_id uuid;
begin
  select c.tenant_id into v_tenant_id from public.clients c where c.id = p_client_id;
  if not found then
    raise exception 'client not found' using errcode = 'no_data_found';
  end if;
  perform private.require_role(p_actor, v_tenant_id, array['owner', 'dispatcher']::public.member_role[]);
  if length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'a note is 1 to 2000 characters' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.client_notes (tenant_id, client_id, author_id, body)
  values (v_tenant_id, p_client_id, p_actor, btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.cmd_resolve_alert(p_alert_id uuid, p_actor uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_tenant_id uuid;
begin
  select a.tenant_id into v_tenant_id from public.dispatch_alerts a where a.id = p_alert_id;
  if not found then
    raise exception 'alert not found' using errcode = 'no_data_found';
  end if;
  perform private.require_role(p_actor, v_tenant_id, array['owner', 'dispatcher']::public.member_role[]);

  update public.dispatch_alerts a
  set resolved_at = now(), resolved_by = p_actor
  where a.id = p_alert_id and a.resolved_at is null;
end;
$$;

revoke all on function
  public.cmd_complete_job(uuid, uuid, jsonb, text, text[]),
  public.cmd_mark_no_access(uuid, uuid, text, bigint),
  public.cmd_add_client_note(uuid, uuid, text),
  public.cmd_resolve_alert(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.cmd_complete_job(uuid, uuid, jsonb, text, text[]),
  public.cmd_mark_no_access(uuid, uuid, text, bigint),
  public.cmd_add_client_note(uuid, uuid, text),
  public.cmd_resolve_alert(uuid, uuid)
to service_role;
