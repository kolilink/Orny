-- ============================================================
-- ORNY / SOL Chips — update16
-- Account deletion — required for App Store submission (Apple
-- Guideline 5.1.1(v): any app that supports account creation must also
-- offer in-app account deletion). Nothing like this existed before.
-- Safe to re-run.
--
-- Every FK to auth.users(id) in this schema is already either
-- `on delete cascade` (factory_members, profiles, join_requests) or
-- `on delete set null` (push_tokens.user_id, investors.user_id, and the
-- created_by/edited_by columns update15.sql added) — none RESTRICT.
-- Every FK to factories(id) is `on delete cascade` too (all 18 of them:
-- sales, products, stock_items, expenses, purchases, investors,
-- investment_entries, investor_distributions, business_documents,
-- machines, customer_orders, suppliers, clients, ...). That means the
-- only thing this function has to reason about explicitly is *which*
-- factories should be deleted outright versus just have this membership
-- removed — everything downstream of that decision is automatic.
--
-- Same shape as Patron's leave_or_delete_business, simplified to a single
-- self-service action (Orny has no separate "leave a factory" menu item
-- to unify with): not admin anywhere problematic -> just leaves every
-- factory; sole admin of a factory with nobody else in it -> that
-- factory is deleted along with the account; admin of a factory that
-- still has other members -> refused outright, naming the factory, so an
-- admin can never vanish out from under a team as a side effect of
-- deleting their own account.
-- ============================================================

create or replace function delete_my_account()
returns void language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_blocking text;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté pour supprimer votre compte.';
  end if;

  select string_agg(f.name, ', ')
  into v_blocking
  from factories f
  where exists (
    select 1 from factory_members fm
    where fm.factory_id = f.id and fm.user_id = v_uid and fm.role = 'admin'
  )
  and exists (
    select 1 from factory_members fm2
    where fm2.factory_id = f.id and fm2.user_id <> v_uid
  );

  if v_blocking is not null then
    raise exception 'Vous êtes administrateur de : %. Retirez les autres membres ou transférez le rôle d''administrateur avant de supprimer votre compte.', v_blocking;
  end if;

  -- Factories where this user is the sole admin and the sole member:
  -- delete the whole factory — there is nobody left for it to exist for.
  delete from factories f
  where exists (
    select 1 from factory_members fm
    where fm.factory_id = f.id and fm.user_id = v_uid and fm.role = 'admin'
  )
  and not exists (
    select 1 from factory_members fm2
    where fm2.factory_id = f.id and fm2.user_id <> v_uid
  );

  -- Deleting the auth.users row cascades everything else this function
  -- didn't handle explicitly: remaining factory_members rows (non-admin
  -- memberships in factories that still have other people), profiles,
  -- join_requests, and nulls out push_tokens.user_id / investors.user_id
  -- / every created_by-or-edited_by column update15.sql added.
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
