-- AI assistant: conversations, their messages and every tool call. Messages and tool calls are append-only
-- (the conversation is replayed to the model exactly as it happened, and the log is evidence of what the
-- assistant did); only a conversation's counters and its current slot hold change.

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel text not null check (channel in ('web', 'portal')),
  -- Set when a signed-in client chats in the portal.
  client_id uuid,
  user_id uuid,
  -- A random id kept in the visitor's cookie, for per-visitor limits; no IP addresses are stored.
  visitor_id text not null,
  model text not null,
  user_turns integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  -- The window the assistant is holding for this conversation (the hold token never reaches the model).
  hold_token uuid,
  booking_id uuid,
  handed_off boolean not null default false,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete set null (booking_id)
);

create index ai_conversations_tenant_idx on public.ai_conversations (tenant_id, last_activity_at desc);
create index ai_conversations_visitor_idx on public.ai_conversations (visitor_id, started_at);

create table public.ai_messages (
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  seq integer not null check (seq >= 0),
  role text not null check (role in ('user', 'assistant')),
  -- Content blocks exactly as sent to / received from the API (thinking blocks included).
  content jsonb not null check (jsonb_typeof(content) = 'array'),
  stop_reason text,
  created_at timestamptz not null default now(),
  primary key (conversation_id, seq)
);

create table public.ai_tool_calls (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  tool_use_id text not null,
  tool_name text not null,
  input jsonb not null,
  output jsonb,
  ok boolean not null,
  error text,
  duration_ms integer not null,
  booking_id uuid,
  created_at timestamptz not null default now()
);

create index ai_tool_calls_conversation_idx on public.ai_tool_calls (conversation_id, id);

create trigger ai_messages_append_only
  before update on public.ai_messages
  for each row execute function private.reject_update();
create trigger ai_tool_calls_append_only
  before update on public.ai_tool_calls
  for each row execute function private.reject_update();
revoke update, delete, truncate on public.ai_messages, public.ai_tool_calls from service_role;

alter table public.dispatch_alerts add column conversation_id uuid
  references public.ai_conversations (id) on delete set null;

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_tool_calls enable row level security;
grant select on public.ai_conversations, public.ai_messages, public.ai_tool_calls to authenticated;

-- Staff review every conversation of their business; nobody else reads the log through the API.
create policy ai_conversations_staff_read on public.ai_conversations
  for select to authenticated using (private.is_staff(tenant_id));
create policy ai_messages_staff_read on public.ai_messages
  for select to authenticated
  using (conversation_id in (select c.id from public.ai_conversations c where private.is_staff(c.tenant_id)));
create policy ai_tool_calls_staff_read on public.ai_tool_calls
  for select to authenticated using (private.is_staff(tenant_id));
