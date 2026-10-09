-- Tenants, staff memberships and crews.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  timezone text not null check (private.is_valid_timezone(timezone)),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  contact_email extensions.citext,
  phone text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.tenants is 'A business using the platform. Every tenant-owned row carries tenant_id.';

-- Staff only. Clients are CRM records (public.clients) and may have no login at all.
create table public.memberships (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id);

create table public.crews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

-- A cleaner belongs to at most one crew.
create table public.crew_members (
  tenant_id uuid not null,
  crew_id uuid not null,
  user_id uuid not null,
  primary key (tenant_id, user_id),
  foreign key (tenant_id, crew_id) references public.crews (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references public.memberships (tenant_id, user_id) on delete cascade
);

create index crew_members_crew_idx on public.crew_members (crew_id);
