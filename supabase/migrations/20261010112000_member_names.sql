-- The name shown for a staff member inside their business (crew lists, booking history). auth.users is not
-- readable through the Data API, so the business keeps its own display name.
alter table public.memberships
  add column display_name text not null default ''
  check (length(display_name) <= 120);
