-- ============================================================
-- Schema Update 2 — Run in Supabase SQL Editor AFTER schema_update.sql
-- Adds: display_name to profiles table
-- ============================================================

-- Add display_name column to profiles
alter table profiles
  add column if not exists display_name text;

-- Update the auto-create profile trigger to include display_name
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, '')
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

-- Update the upsert RPC to include display_name
create or replace function upsert_my_profile(user_email text, user_display_name text default '')
returns void language sql security definer as $$
  insert into profiles (id, email, display_name)
  values (auth.uid(), user_email, user_display_name)
  on conflict (id) do update
    set email = excluded.email,
        display_name = case
          when excluded.display_name = '' then profiles.display_name
          else excluded.display_name
        end;
$$;
