-- ============================================================
-- ORNY / SOL Chips — update25
-- Orny AI gets real conversations: a factory member can have several named
-- sessions (like a Claude/ChatGPT-style "New chat"), each with its own
-- persisted message history, instead of everything living in one
-- component's in-memory state that's gone the moment the screen unmounts.
-- See CLAUDE.md "Orny AI — real sessions, no more unsolicited auto-brief"
-- for the full design. Safe to re-run.
--
-- Personal, not shared: a conversation belongs to exactly the (factory,
-- user) pair that started it — even another admin of the same factory
-- can't read someone else's chat with the AI. Matches the sibling Patron
-- app's own Alpha advisor, which scopes conversations the same way.
-- ============================================================

create table if not exists coach_conversations (
  id              uuid primary key default gen_random_uuid(),
  factory_id      uuid not null references factories(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists coach_conversations_owner_idx
  on coach_conversations (factory_id, user_id, last_message_at desc);

create table if not exists coach_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references coach_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index if not exists coach_messages_conversation_idx
  on coach_messages (conversation_id, created_at);

alter table coach_conversations enable row level security;
alter table coach_messages enable row level security;

drop policy if exists "own conversations select" on coach_conversations;
drop policy if exists "own conversations insert" on coach_conversations;
drop policy if exists "own conversations update" on coach_conversations;
drop policy if exists "own conversations delete" on coach_conversations;

create policy "own conversations select"
  on coach_conversations for select using (user_id = auth.uid());
create policy "own conversations insert"
  on coach_conversations for insert with check (
    user_id = auth.uid() and factory_id in (select my_factory_ids())
  );
-- Update is only ever a title rename or the last_message_at touch on a new
-- message — never a factory_id/user_id reassignment, so no extra WITH
-- CHECK beyond re-confirming ownership is needed.
create policy "own conversations update"
  on coach_conversations for update using (user_id = auth.uid());
create policy "own conversations delete"
  on coach_conversations for delete using (user_id = auth.uid());

drop policy if exists "own messages select" on coach_messages;
drop policy if exists "own messages insert" on coach_messages;

-- No update/delete policy on coach_messages at all, anywhere, deliberately
-- — an immutable log, the same "nobody edits history, not even the owner"
-- posture update15.sql already established for sale_edits/investment_entry_edits.
-- Deleting a whole conversation still works via the FK's own
-- `on delete cascade` from coach_conversations.
create policy "own messages select"
  on coach_messages for select using (
    exists (select 1 from coach_conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );
create policy "own messages insert"
  on coach_messages for insert with check (
    exists (select 1 from coach_conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );
