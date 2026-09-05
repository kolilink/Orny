-- ============================================================
-- ORNY / SOL Chips — update12
-- Real (server-triggered) push notifications, on top of the existing
-- local-only expo-notifications alerts in utils/notifications.ts.
-- push_tokens holds one row per physical device install, keyed by the
-- Expo push token itself (not by user+factory — the same device keeps the
-- same token across logins) so the dispatch-notification edge function can
-- resolve "who to push" server-side from real factory membership, never
-- from a client-supplied recipient list.
-- Safe to re-run.
-- ============================================================

create table if not exists push_tokens (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  factory_id        uuid not null references factories(id) on delete cascade,
  expo_push_token   text not null unique,
  platform          text not null check (platform in ('ios', 'android')),
  updated_at        timestamptz not null default now()
);

create index if not exists push_tokens_factory_id_idx on push_tokens(factory_id);
create index if not exists push_tokens_user_id_idx on push_tokens(user_id);

alter table push_tokens enable row level security;

-- A device only ever registers/updates its OWN token. dispatch-notification
-- itself runs with the service-role key and bypasses RLS entirely — it IS
-- the trust boundary that resolves real recipients — so no SELECT policy is
-- needed here for the read side.
drop policy if exists "own token insert" on push_tokens;
create policy "own token insert"
  on push_tokens for insert
  with check (user_id = auth.uid() and factory_id in (select my_factory_ids()));

drop policy if exists "own token update" on push_tokens;
create policy "own token update"
  on push_tokens for update
  using (user_id = auth.uid());

drop policy if exists "own token delete" on push_tokens;
create policy "own token delete"
  on push_tokens for delete
  using (user_id = auth.uid());
