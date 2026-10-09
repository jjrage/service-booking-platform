-- What the crew checks off for each service. Tenant data like prices: the owner edits it, the crew app shows it.
alter table public.services
  add column checklist text[] not null default '{}'
  check (cardinality(checklist) <= 30);
