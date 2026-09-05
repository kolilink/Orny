-- ============================================================
-- ORNY / SOL Chips — update10
-- 1. Adds a 'vendeur' (seller-only) role: can record sales and
--    manage clients, but has no access to production, stock edits,
--    expenses, documents, suppliers, or investor data.
-- 2. Adds investor_distributions — tracks capital PAID OUT to an
--    investor (distinct from investment_entries, which is capital
--    paid IN). Previously there was no way to record a payout at all.
-- 3. Adds purchases.stock_item_id so a supplier purchase can be
--    reliably linked to (and auto-increment) a raw-material stock row.
-- Safe to re-run.
-- ============================================================

-- ── 1a. Allow 'vendeur' in factory_members.role ────────────────
alter table factory_members drop constraint if exists factory_members_role_check;
alter table factory_members add constraint factory_members_role_check
  check (role in ('admin', 'employee', 'investor', 'vendeur'));

alter table join_requests drop constraint if exists join_requests_assigned_role_check;
alter table join_requests add constraint join_requests_assigned_role_check
  check (assigned_role in ('admin', 'employee', 'investor', 'vendeur'));

-- ── 1b. Let vendeur record sales & manage clients ──────────────
drop policy if exists "staff insert sales" on sales;
create policy "staff insert sales"
  on sales for insert with check (
    factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin','employee','vendeur'));

drop policy if exists "staff update sales" on sales;
create policy "staff update sales"
  on sales for update using (
    factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin','employee','vendeur'));

drop policy if exists "staff insert clients" on clients;
create policy "staff insert clients"
  on clients for insert with check (
    factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin','employee','vendeur'));

drop policy if exists "staff update clients" on clients;
create policy "staff update clients"
  on clients for update using (
    factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin','employee','vendeur'));

-- Everything else (production_batches, production_products,
-- production_batches_v2, stock_items writes, business_documents,
-- expenses, suppliers, purchases, customer_orders, investors,
-- investment_entries, product_flavors, bulk_products writes)
-- intentionally keeps its existing admin/employee-only policies —
-- vendeur is not added to any of them, so it only inherits the
-- unrestricted-role SELECT policies already in place (read-only).

-- ── 2. Investor distributions (payouts) ────────────────────────
create table if not exists investor_distributions (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references factories(id) on delete cascade,
  investor_id uuid not null references investors(id) on delete cascade,
  amount      integer not null check (amount > 0),
  date        text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table investor_distributions enable row level security;

drop policy if exists "read distributions" on investor_distributions;
create policy "read distributions"
  on investor_distributions for select using (
    investor_id in (select id from investors where user_id = auth.uid())
    or my_role_in(factory_id) in ('admin','employee'));

drop policy if exists "admin write distributions" on investor_distributions;
create policy "admin write distributions"
  on investor_distributions for insert with check (my_role_in(factory_id) = 'admin');

drop policy if exists "admin update distributions" on investor_distributions;
create policy "admin update distributions"
  on investor_distributions for update using (my_role_in(factory_id) = 'admin');

drop policy if exists "admin delete distributions" on investor_distributions;
create policy "admin delete distributions"
  on investor_distributions for delete using (my_role_in(factory_id) = 'admin');

-- ── 3. Link purchases to a stock item so buying can auto-restock ─
alter table purchases add column if not exists stock_item_id text;
