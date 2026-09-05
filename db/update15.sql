-- ============================================================
-- ORNY / SOL Chips — update15
-- First-principles pass on trust + cost correctness, safe to re-run.
--
-- 1. Attribution: every money-moving row now records who created it,
--    stamped server-side (a trigger sets it from auth.uid() — the
--    client can send anything, it gets overwritten). Previously
--    sales/purchases/expenses/investment_entries/investor_distributions/
--    production_batches_v2 had no actor column at all.
-- 2. Append-only edit history for sales and investment_entries — the
--    two record types people actually dispute. A BEFORE UPDATE trigger
--    snapshots old->new into a dedicated table on every edit; that
--    table has no client-reachable INSERT/UPDATE/DELETE policy at all
--    (only the SECURITY DEFINER trigger function can write to it), so
--    a row can't be edited without leaving a trace, and the trace
--    itself can't be edited or deleted by anyone, including admin.
--    investor_distributions has no edit path in the app (only
--    add/delete), so there's nothing to snapshot there.
-- 3. Purchases gain `amount_paid`, mirroring sales.amount_paid exactly
--    — the same field that already makes Créances work for client
--    debt, now doing the same job for what's owed to a supplier. No
--    new ledger table needed.
-- 4. Weighted-average cost: stock_items gains `avg_cost` (numeric,
--    GNF per unit), updated whenever stock is added (a purchase, or
--    a production batch adding finished goods costed from the raw
--    materials it consumed). sales gains `cost_amount` (numeric,
--    total GNF cost for that sale, stamped at sale time from the
--    sold item's avg_cost) — this is what lets Reports compute real
--    profit instead of expensing a purchase in the month it happened
--    to be bought. Existing stock_items are backfilled from their own
--    purchase history where they have one; sales.cost_amount has no
--    backfill (no historical batch-costing data exists) and stays
--    null for pre-migration sales — Reports treats null as "unknown"
--    for that period, not zero.
-- 5. A new read-only 'inspecteur' role (police/tax/health inspector,
--    or any outside auditor) — added to the existing role model the
--    same way 'vendeur' was in update10.sql. It inherits read access
--    to every table whose SELECT policy is already unrestricted by
--    role (sales, purchases, production, stock, expenses, suppliers,
--    documents, customer_orders, clients) simply by being a real
--    factory_members role — no new SELECT policies needed there, and
--    it is deliberately never added to any INSERT/UPDATE/DELETE
--    policy, so it is structurally read-only at the database level,
--    not just hidden buttons in the UI. investors/investment_entries
--    are the cap table, not an operations record — those two SELECT
--    policies are tightened to explicitly exclude inspecteur.
-- ============================================================

-- ── 1. Attribution ──────────────────────────────────────────────
create or replace function set_created_by()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['sales', 'purchases', 'expenses', 'investment_entries', 'investor_distributions', 'production_batches_v2']
  loop
    execute format('alter table %I add column if not exists created_by uuid references auth.users(id) on delete set null', t);
    execute format('drop trigger if exists %I_set_created_by on %I', t, t);
    execute format('create trigger %I_set_created_by before insert on %I for each row execute function set_created_by()', t, t);
  end loop;
end $$;

-- ── 2. Append-only edit history (sales, investment_entries) ────
create table if not exists sale_edits (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references sales(id) on delete cascade,
  factory_id uuid not null references factories(id) on delete cascade,
  edited_by  uuid references auth.users(id) on delete set null,
  edited_at  timestamptz not null default now(),
  before     jsonb not null,
  after      jsonb not null
);
alter table sale_edits enable row level security;
drop policy if exists "members read sale edits" on sale_edits;
create policy "members read sale edits" on sale_edits for select using (factory_id in (select my_factory_ids()));
-- No insert/update/delete policy for any client role, on purpose — see
-- log_sale_edit() below, the only writer, running as a SECURITY DEFINER
-- trigger. Nobody, including admin, can write to this table directly.

create table if not exists investment_entry_edits (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references investment_entries(id) on delete cascade,
  factory_id uuid not null references factories(id) on delete cascade,
  edited_by  uuid references auth.users(id) on delete set null,
  edited_at  timestamptz not null default now(),
  before     jsonb not null,
  after      jsonb not null
);
alter table investment_entry_edits enable row level security;
drop policy if exists "members read entry edits" on investment_entry_edits;
create policy "members read entry edits" on investment_entry_edits for select using (factory_id in (select my_factory_ids()));

alter table sales add column if not exists updated_at timestamptz not null default now();
alter table investment_entries add column if not exists updated_at timestamptz not null default now();

create or replace function log_sale_edit()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into sale_edits (sale_id, factory_id, edited_by, before, after)
  values (old.id, old.factory_id, auth.uid(), to_jsonb(old), to_jsonb(new));
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists sale_edit_audit on sales;
create trigger sale_edit_audit before update on sales for each row execute function log_sale_edit();

create or replace function log_investment_entry_edit()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into investment_entry_edits (entry_id, factory_id, edited_by, before, after)
  values (old.id, old.factory_id, auth.uid(), to_jsonb(old), to_jsonb(new));
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists investment_entry_edit_audit on investment_entries;
create trigger investment_entry_edit_audit before update on investment_entries for each row execute function log_investment_entry_edit();

-- ── 3. Purchases: amount_paid, mirroring sales exactly ──────────
alter table purchases add column if not exists amount_paid integer;

-- ── 4. Weighted-average cost ─────────────────────────────────────
alter table stock_items add column if not exists avg_cost numeric not null default 0;
alter table sales add column if not exists cost_amount numeric;

-- One-time backfill: prime each stock item's cost basis from its own
-- purchase history (quantity-weighted average unit price) instead of
-- starting every item at a false 0. Finished-goods items (nothing
-- ever purchases into them) stay at 0 until their first post-migration
-- batch establishes a real cost — there's no historical batch-costing
-- data to reconstruct that from.
update stock_items si
set avg_cost = sub.wavg
from (
  select stock_item_id, sum(quantity * unit_price)::numeric / nullif(sum(quantity), 0) as wavg
  from purchases
  where stock_item_id is not null
  group by stock_item_id
) sub
where sub.stock_item_id = si.id and sub.wavg is not null;

-- ── 5. inspecteur role ────────────────────────────────────────────
alter table factory_members drop constraint if exists factory_members_role_check;
alter table factory_members add constraint factory_members_role_check
  check (role in ('admin', 'employee', 'investor', 'vendeur', 'inspecteur'));

alter table join_requests drop constraint if exists join_requests_assigned_role_check;
alter table join_requests add constraint join_requests_assigned_role_check
  check (assigned_role in ('admin', 'employee', 'investor', 'vendeur', 'inspecteur'));

-- Cap table stays private from inspecteur — everything else it reads
-- for free via the existing unrestricted "members read ..." policies.
drop policy if exists "members read investors" on investors;
create policy "members read investors" on investors for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'inspecteur'
);
drop policy if exists "members read entries" on investment_entries;
create policy "members read entries" on investment_entries for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'inspecteur'
);
-- investor_distributions' existing read policy is already scoped to
-- admin/employee/the-investor-themselves — inspecteur is excluded by
-- simply not being in that list, no change needed there.
