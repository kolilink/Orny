-- ============================================================
-- ORNY / SOL Chips — update26
-- customer_orders gains order_group_id — lets one client's order span
-- several products (a real phone-in order is almost never "one product,
-- one order," which is all the previous schema/UI could express) instead
-- of forcing a separate, individually-tracked order per line item. See
-- CLAUDE.md "Commandes clients — commande multi-produits" for the full
-- design (why a grouping column instead of a normalized order_lines table).
--
-- Additive and backward-compatible: every existing row is backfilled to
-- its OWN id as its group id, so a legacy single-product order groups to
-- exactly itself with zero special-casing anywhere in the app — "group by
-- order_group_id" already does the right thing for old and new data alike.
-- A new order always sets this explicitly client-side (one fresh id shared
-- by every line belonging to that order), never a DB default, since a
-- default has no way to know the row's own id at insert time.
-- Safe to re-run.
-- ============================================================

alter table customer_orders add column if not exists order_group_id uuid;
update customer_orders set order_group_id = id where order_group_id is null;
alter table customer_orders alter column order_group_id set not null;
alter table customer_orders alter column order_group_id set default gen_random_uuid();

create index if not exists customer_orders_group_idx on customer_orders (factory_id, order_group_id);
