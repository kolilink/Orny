-- update29.sql — Dad can record production batches (2026-10-24)
--
-- Real-people account model: dad ('vendeur' in the DB) is the ONLY person
-- on the ground, and his job is exactly two things — record a sale, record
-- a production batch. Sales already allowed vendeur (update10/update27).
-- Production + stock did NOT: batch insert/update and stock insert/update
-- were admin/manager-only (update27), so a dad-role batch would cache
-- locally, fail on RLS, and dead-letter after 5 queue attempts — the batch
-- would look saved on his phone and never reach Supabase.
--
-- This migration adds 'vendeur' to the INSERT and UPDATE policies for:
--   production_batches (legacy, still live)
--   production_batches_v2 (the table store/batches.ts actually writes)
--   stock_items (a batch save deducts raw materials and adds finished
--                goods via upsert, which needs BOTH insert and update)
--
-- Deliberately UNCHANGED: DELETE stays admin/manager-only on all three
-- tables, so dad can record and correct a batch but can never delete one
-- by accident. Sebastiao (admin) + Alpha (manager) delete mistakes.
-- SELECT is unchanged (every member except investor already reads these).
--
-- NOT APPLIED BY THE APP. Run this once in the Supabase SQL Editor,
-- BEFORE dad records his first batch on the new build. Until it is run,
-- his batches stay local-only. Verify with: a vendeur-role insert into
-- production_batches_v2 must succeed; a vendeur delete must still fail.

-- production_batches (legacy)
drop policy if exists "staff insert production" on production_batches;
create policy "staff insert production" on production_batches for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'));
drop policy if exists "staff update production" on production_batches;
create policy "staff update production" on production_batches for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'));

-- stock_items (upsert = insert + update)
drop policy if exists "staff insert stock" on stock_items;
create policy "staff insert stock" on stock_items for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'));
drop policy if exists "staff update stock" on stock_items;
create policy "staff update stock" on stock_items for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'));

-- production_batches_v2 (guarded: the table may not exist on every DB)
do $$
begin
  if to_regclass('public.production_batches_v2') is not null then
    execute 'drop policy if exists "staff insert batches v2" on production_batches_v2';
    execute $p$create policy "staff insert batches v2" on production_batches_v2 for insert with check (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'))$p$;
    execute 'drop policy if exists "staff update batches v2" on production_batches_v2';
    -- update27 created no update policy for v2 (insert + admin-delete only);
    -- add one so dad can correct a batch he just entered.
    execute $p$create policy "staff update batches v2" on production_batches_v2 for update using (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'))$p$;
  end if;
end $$;
