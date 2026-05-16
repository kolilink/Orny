-- ============================================================
-- REPAIR — Run this single file in Supabase SQL Editor
-- Safe to run on any database state (idempotent)
-- ============================================================

-- ─── PROFILES ────────────────────────────────────────────────
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Add display_name (safe if already exists)
alter table profiles add column if not exists display_name text;

drop policy if exists "authenticated users can read profiles" on profiles;
create policy "authenticated users can read profiles"
  on profiles for select using (auth.uid() is not null);

drop policy if exists "users can upsert own profile" on profiles;
create policy "users can upsert own profile"
  on profiles for insert with check (id = auth.uid());

drop policy if exists "users can update own profile" on profiles;
create policy "users can update own profile"
  on profiles for update using (id = auth.uid());

-- ─── TRIGGER: auto-create profile on every new signup ────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, '')
  on conflict (id) do update
    set email = excluded.email;
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

-- ─── REMOVE direct-join policy ───────────────────────────────
drop policy if exists "users can join via invite code" on factory_members;

-- ─── RPCs ─────────────────────────────────────────────────────
create or replace function lookup_factory_by_code(code text)
returns table(id uuid, name text) language sql security definer
set search_path = public
as $$
  select id, name from factories where invite_code = upper(trim(code));
$$;

create or replace function upsert_my_profile(user_email text, user_display_name text default '')
returns void language sql security definer
set search_path = public
as $$
  insert into profiles (id, email, display_name)
  values (auth.uid(), user_email, user_display_name)
  on conflict (id) do update
    set email = excluded.email,
        display_name = case
          when excluded.display_name = '' then profiles.display_name
          else excluded.display_name
        end;
$$;

-- ─── ADMIN-ONLY INVITE CODE LOOKUP ───────────────────────────
-- Returns the invite code only if the calling user is an admin
-- of the requested factory; returns NULL for all other roles.
create or replace function get_my_invite_code(fid uuid)
returns text language sql security definer
set search_path = public
as $$
  select invite_code
  from factories
  where id = fid
    and exists (
      select 1 from factory_members
      where factory_id = fid
        and user_id = auth.uid()
        and role = 'admin'
    );
$$;

-- ─── ATOMIC JOIN-REQUEST APPROVAL ────────────────────────────
-- Inserts the new factory_member and marks the request approved
-- in a single transaction. Verifies admin role server-side.
-- User ID is taken from the join_request row — caller cannot
-- substitute a different user.
create or replace function approve_join_request(req_id uuid, target_role text)
returns void language plpgsql security definer
set search_path = public
as $$
declare
  v_factory_id uuid;
  v_user_id    uuid;
begin
  select factory_id, user_id
    into v_factory_id, v_user_id
    from join_requests
   where id = req_id and status = 'pending';

  if v_factory_id is null then
    raise exception 'join_request not found or already processed';
  end if;

  if not exists (
    select 1 from factory_members
     where factory_id = v_factory_id
       and user_id    = auth.uid()
       and role       = 'admin'
  ) then
    raise exception 'caller is not an admin of this factory';
  end if;

  insert into factory_members (factory_id, user_id, role)
  values (v_factory_id, v_user_id, target_role);

  update join_requests
     set status = 'approved', assigned_role = target_role
   where id = req_id;
end;
$$;

-- ─── PROFILES RLS: scope reads to own profile + co-members ────
-- Replaces the overly-broad "any auth user can read all profiles"
-- policy that allowed full email enumeration across all factories.
drop policy if exists "authenticated users can read profiles" on profiles;
drop policy if exists "users can read relevant profiles" on profiles;

create policy "users can read relevant profiles"
  on profiles for select
  using (
    id = auth.uid()
    or id in (
      select user_id from factory_members
       where factory_id in (select my_factory_ids())
    )
  );

-- ─── INVITE CODE: CSPRNG via gen_random_uuid() (no pgcrypto needed) ───
create or replace function generate_invite_code()
returns text language sql
set search_path = public
as $$
  select upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
$$;
