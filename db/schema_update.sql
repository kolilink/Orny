-- ============================================================
-- Schema Update — Run in Supabase SQL Editor AFTER schema.sql
-- Adds: profiles, join_requests, factory lookup RPC
-- Updates: factory_members RLS (removes direct-join policy)
-- Safe to re-run: uses IF NOT EXISTS and DROP … IF EXISTS
-- ============================================================

-- ─── PROFILES (stores user email for display in admin UI) ────
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "authenticated users can read profiles" on profiles;
create policy "authenticated users can read profiles"
  on profiles for select using (auth.uid() is not null);

drop policy if exists "users can upsert own profile" on profiles;
create policy "users can upsert own profile"
  on profiles for insert with check (id = auth.uid());

drop policy if exists "users can update own profile" on profiles;
create policy "users can update own profile"
  on profiles for update using (id = auth.uid());

-- Auto-create profile on every new signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─── JOIN REQUESTS ────────────────────────────────────────────
create table if not exists join_requests (
  id            uuid primary key default gen_random_uuid(),
  factory_id    uuid not null references factories(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  user_email    text not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  assigned_role text check (assigned_role in ('admin', 'employee', 'investor')),
  created_at    timestamptz not null default now(),
  unique(factory_id, user_id)
);

alter table join_requests enable row level security;

drop policy if exists "users can create their own request" on join_requests;
create policy "users can create their own request"
  on join_requests for insert
  with check (user_id = auth.uid());

drop policy if exists "users can read their own requests" on join_requests;
create policy "users can read their own requests"
  on join_requests for select
  using (user_id = auth.uid());

drop policy if exists "users can cancel their pending request" on join_requests;
create policy "users can cancel their pending request"
  on join_requests for delete
  using (user_id = auth.uid() and status = 'pending');

drop policy if exists "admins can read factory requests" on join_requests;
create policy "admins can read factory requests"
  on join_requests for select
  using (
    factory_id in (
      select factory_id from factory_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "admins can update factory requests" on join_requests;
create policy "admins can update factory requests"
  on join_requests for update
  using (
    factory_id in (
      select factory_id from factory_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- ─── REMOVE direct-join policy (all joins now go via requests) ─
drop policy if exists "users can join via invite code" on factory_members;

-- ─── RPC: lookup factory by invite code (bypasses RLS) ────────
create or replace function lookup_factory_by_code(code text)
returns table(id uuid, name text) language sql security definer as $$
  select id, name from factories where invite_code = upper(trim(code));
$$;

-- ─── RPC: upsert current user's profile ───────────────────────
create or replace function upsert_my_profile(user_email text)
returns void language sql security definer as $$
  insert into profiles (id, email)
  values (auth.uid(), user_email)
  on conflict (id) do update set email = excluded.email;
$$;
