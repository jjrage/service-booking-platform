-- Clients (CRM records), staff-only notes, and the homes clients book cleanings for.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Set once the client signs in to the portal.
  user_id uuid references auth.users (id) on delete set null,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email extensions.citext not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone ~ '^\+?[0-9 ().-]{7,20}$'),
  source public.client_source not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, email),
  unique (tenant_id, user_id)
);

create index clients_user_idx on public.clients (user_id);

create trigger clients_touch_updated_at
  before update on public.clients
  for each row execute function private.touch_updated_at();

-- Separate table because row-level security filters rows, not columns: a client can read their own
-- clients row but must never read what staff wrote about them.
create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid not null,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade
);

create index client_notes_client_idx on public.client_notes (tenant_id, client_id, created_at desc);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid not null,
  label text not null default 'Home' check (length(btrim(label)) between 1 and 40),
  address_line1 text not null check (length(btrim(address_line1)) between 1 and 120),
  address_line2 text,
  city text not null check (length(btrim(city)) between 1 and 60),
  state char(2) not null check (state ~ '^[A-Z]{2}$'),
  zip text not null check (zip ~ '^[0-9]{5}$'),
  bedrooms integer not null check (bedrooms between 0 and 20),
  full_baths integer not null check (full_baths between 0 and 20),
  half_baths integer not null default 0 check (half_baths between 0 and 20),
  sqft integer check (sqft between 100 and 20000),
  has_pets boolean not null default false,
  pet_notes text,
  access_notes text,
  parking_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- Lets a booking reference (tenant, client, property) so a booking cannot use another client's home.
  unique (tenant_id, client_id, id),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade
);

create index properties_client_idx on public.properties (tenant_id, client_id);

create trigger properties_touch_updated_at
  before update on public.properties
  for each row execute function private.touch_updated_at();
