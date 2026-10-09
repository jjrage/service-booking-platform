-- Services and versioned business rules (pricing, schedule, cancellation).

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '',
  booking_mode public.booking_mode not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

-- Rules are tenant data, not code. A change publishes a new version; old bookings keep the version they
-- were priced with. The JSON shape is validated by the server (Zod); the database only requires an object.
create table public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind public.rule_kind not null,
  version integer not null check (version > 0),
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  effective_from timestamptz not null default now(),
  note text not null default '',
  -- Plain uuid, not a foreign key: an append-only row cannot be rewritten when a user is deleted.
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, kind, version)
);

create index rule_versions_current_idx on public.rule_versions (tenant_id, kind, effective_from desc);

create trigger rule_versions_append_only
  before update on public.rule_versions
  for each row execute function private.reject_update();

revoke update, delete, truncate on public.rule_versions from service_role;
