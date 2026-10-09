-- Foundation: deny-by-default privileges, schemas, extensions, shared types and helpers.

-- Supabase grants anon and authenticated full access to new tables and EXECUTE on new functions in
-- public. This project denies by default: every privilege the app relies on is granted explicitly in a
-- later migration, and tests assert that nothing else is reachable.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;

-- Helpers for policies, constraints and commands. Not exposed through the Data API.
create schema private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create type public.member_role as enum ('owner', 'dispatcher', 'cleaner');
create type public.rule_kind as enum ('pricing', 'schedule', 'cancellation');
create type public.booking_mode as enum ('instant', 'quote_request', 'class');
create type public.client_source as enum ('web', 'portal', 'admin', 'ai', 'import');
create type public.booking_source as enum ('web', 'portal', 'admin', 'ai', 'plan');
create type public.booking_status as enum (
  'pending_payment', 'confirmed', 'completed', 'no_access', 'cancelled', 'expired'
);
create type public.allocation_kind as enum ('hold', 'booking', 'time_off');
create type public.actor_kind as enum ('guest', 'client', 'staff', 'crew', 'ai', 'system');
create type public.booking_event_type as enum (
  'created', 'confirmed', 'rescheduled', 'reassigned', 'cancelled', 'completed', 'no_access',
  'expired', 'payment_failed'
);
create type public.plan_frequency as enum ('weekly', 'biweekly', 'monthly');
create type public.plan_status as enum ('active', 'paused', 'cancelled');
create type public.alert_kind as enum ('plan_conflict', 'handoff', 'payment_failed');

-- True when the name is an IANA time zone Postgres knows (e.g. America/New_York).
create function private.is_valid_timezone(p_timezone text) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  perform now() at time zone p_timezone;
  return true;
exception
  when invalid_parameter_value then
    return false;
end;
$$;

grant execute on function private.is_valid_timezone(text) to anon, authenticated, service_role;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Append-only tables (rule versions, audit trails) reject updates from every role, including the
-- service role. Direct deletes are revoked separately; deleting a whole tenant still cascades.
create function private.reject_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;
