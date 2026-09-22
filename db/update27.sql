-- ============================================================
-- ORNY / SOL Chips — update27
-- Role model redesign, direct product request. Three changes:
--
-- 1. 'employee' renamed to 'manager', and widened to admin-parity on
--    everything EXCEPT team/factory ownership (approving joins, changing
--    roles, removing members, factory settings/deletion) — those stay
--    admin-only. A manager can now do everything else admin can: edit the
--    product catalog/pricing, delete records, and manage investor capital
--    entries (record apports/retraits). Multiple managers were already
--    possible (no cap on factory_members rows per role, same as admin).
--
-- 2. 'investor' is scoped down to genuinely their own data — previously
--    every "members read X" policy in this schema granted blanket
--    factory-wide read access with no role filter at all (or, for
--    investors/investment_entries specifically, excluded only
--    'inspecteur' — an investor could already read every OTHER investor's
--    capital/share data too, not just their own, via a raw query, even
--    though the UI politely only ever showed their own row). Investor is
--    now excluded from every operational/transactional table (sales,
--    clients, expenses, purchases, suppliers, customer_orders, production,
--    stock, machines, documents, sale_edits) — Reports (screens/Reports)
--    switches to the new get_investor_headline_report() RPC below for that
--    role instead of reading those tables directly, and Orny AI (Coach) is
--    no longer offered to investor at all in the app (see Plus screen) —
--    both changes needed together, since keeping either would leave a
--    backdoor to full data an RLS change alone can't close. investors/
--    investment_entries now correctly scope to the caller's own row (join
--    on investors.user_id), not just "not inspecteur"; investor_distributions
--    was already correctly scoped this way and only needed the role rename.
--    Product catalog (product_flavors/bulk_products) and the team roster
--    (factory_members) are left universally readable — low-sensitivity
--    (names/prices, names/roles), not the kind of detail this change is
--    about.
--
-- 3. get_investor_headline_report(factory_id) — a SECURITY DEFINER RPC
--    replicating utils/finance.ts's computePeriodProfit()/computeCashOnHand()
--    formulas in SQL, so an investor's restricted Reports view can still
--    show real revenue/profit-trend/cash-on-hand headline numbers without
--    needing direct table access to compute them client-side. Any factory
--    member can call it (the numbers aren't sensitive in aggregate form,
--    and admin/manager already see the unaggregated version anyway) — the
--    real gate is factory membership, not a specific role.
--
-- Not touched, deliberately: investment_entry_edits' own read policy
-- (still factory-wide, not scoped per-investor) — the UI never surfaces
-- another investor's edit history (InvestorDetail only ever opens the
-- viewer's own investorId), so this is a real but low-severity residual
-- gap, flagged here rather than fixed blind without a way to verify the
-- rewritten policy against a live database first.
--
-- Safe to re-run.
-- ============================================================

-- ── 1a. Role rename: employee → manager ─────────────────────────
-- Order matters here: the data MUST be converted before the new, stricter
-- constraint is added — ADD CONSTRAINT validates every existing row
-- immediately (no NOT VALID), and the new list no longer contains
-- 'employee', so adding it first (against a table that still has real
-- 'employee' rows) fails outright with a check-constraint violation. Drop
-- the old constraint, migrate the data while the column is briefly
-- unconstrained, then add the new constraint once every row already
-- satisfies it.
alter table factory_members drop constraint if exists factory_members_role_check;
update factory_members set role = 'manager' where role = 'employee';
alter table factory_members add constraint factory_members_role_check
  check (role in ('admin', 'manager', 'investor', 'vendeur', 'inspecteur'));

alter table join_requests drop constraint if exists join_requests_assigned_role_check;
update join_requests set assigned_role = 'manager' where assigned_role = 'employee';
alter table join_requests add constraint join_requests_assigned_role_check
  check (assigned_role in ('admin', 'manager', 'investor', 'vendeur', 'inspecteur'));

-- ── 1b. Operational tables: rename employee→manager on write (INSERT/
--       UPDATE), widen DELETE from admin-only to admin+manager, and
--       exclude investor from SELECT (see header note above). vendeur's
--       existing narrow write access (sales, clients) is preserved as-is.
-- ─────────────────────────────────────────────────────────────────

-- sales
drop policy if exists "members read sales" on sales;
create policy "members read sales" on sales for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
);
drop policy if exists "staff insert sales" on sales;
create policy "staff insert sales" on sales for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'));
drop policy if exists "staff update sales" on sales;
create policy "staff update sales" on sales for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'));
drop policy if exists "admin delete sales" on sales;
create policy "admin delete sales" on sales for delete using (my_role_in(factory_id) in ('admin','manager'));

-- production_batches (legacy table — still live, see CLAUDE.md)
drop policy if exists "members read production" on production_batches;
create policy "members read production" on production_batches for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
);
drop policy if exists "staff insert production" on production_batches;
create policy "staff insert production" on production_batches for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "staff update production" on production_batches;
create policy "staff update production" on production_batches for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete production" on production_batches;
create policy "admin delete production" on production_batches for delete using (my_role_in(factory_id) in ('admin','manager'));

-- stock_items
drop policy if exists "members read stock" on stock_items;
create policy "members read stock" on stock_items for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
);
drop policy if exists "staff insert stock" on stock_items;
create policy "staff insert stock" on stock_items for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "staff update stock" on stock_items;
create policy "staff update stock" on stock_items for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete stock" on stock_items;
create policy "admin delete stock" on stock_items for delete using (my_role_in(factory_id) in ('admin','manager'));

-- clients
drop policy if exists "members read clients" on clients;
create policy "members read clients" on clients for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
);
drop policy if exists "staff insert clients" on clients;
create policy "staff insert clients" on clients for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'));
drop policy if exists "staff update clients" on clients;
create policy "staff update clients" on clients for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager','vendeur'));
drop policy if exists "admin delete clients" on clients;
create policy "admin delete clients" on clients for delete using (my_role_in(factory_id) in ('admin','manager'));

-- business_documents (row) + its two storage buckets
drop policy if exists "members read docs" on business_documents;
create policy "members read docs" on business_documents for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
);
drop policy if exists "staff insert docs" on business_documents;
create policy "staff insert docs" on business_documents for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "staff update docs" on business_documents;
create policy "staff update docs" on business_documents for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete docs" on business_documents;
create policy "admin delete docs" on business_documents for delete using (my_role_in(factory_id) in ('admin','manager'));

drop policy if exists "members read business documents" on storage.objects;
create policy "members read business documents" on storage.objects for select using (
  bucket_id = 'business-documents'
  and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
  and my_role_in((storage.foldername(name))[1]::uuid) <> 'investor'
);
drop policy if exists "staff upload business documents" on storage.objects;
create policy "staff upload business documents" on storage.objects for insert with check (
  bucket_id = 'business-documents'
  and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
  and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','manager')
);
drop policy if exists "staff update business documents" on storage.objects;
create policy "staff update business documents" on storage.objects for update using (
  bucket_id = 'business-documents'
  and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
  and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','manager')
);
drop policy if exists "admin delete business documents" on storage.objects;
create policy "admin delete business documents" on storage.objects for delete using (
  bucket_id = 'business-documents'
  and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','manager')
);

-- expenses (row) + its receipt-photo storage bucket
drop policy if exists "members read expenses" on expenses;
create policy "members read expenses" on expenses for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
);
drop policy if exists "staff insert expenses" on expenses;
create policy "staff insert expenses" on expenses for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "staff update expenses" on expenses;
create policy "staff update expenses" on expenses for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete expenses" on expenses;
create policy "admin delete expenses" on expenses for delete using (my_role_in(factory_id) in ('admin','manager'));

drop policy if exists "members read expense receipts" on storage.objects;
create policy "members read expense receipts" on storage.objects for select using (
  bucket_id = 'expense-receipts'
  and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
  and my_role_in((storage.foldername(name))[1]::uuid) <> 'investor'
);
drop policy if exists "staff upload expense receipts" on storage.objects;
create policy "staff upload expense receipts" on storage.objects for insert with check (
  bucket_id = 'expense-receipts'
  and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
  and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','manager')
);
drop policy if exists "staff update expense receipts" on storage.objects;
create policy "staff update expense receipts" on storage.objects for update using (
  bucket_id = 'expense-receipts'
  and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
  and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','manager')
);
drop policy if exists "admin delete expense receipts" on storage.objects;
create policy "admin delete expense receipts" on storage.objects for delete using (
  bucket_id = 'expense-receipts'
  and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','manager')
);

-- suppliers
drop policy if exists "members read suppliers" on suppliers;
create policy "members read suppliers" on suppliers for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
);
drop policy if exists "staff insert suppliers" on suppliers;
create policy "staff insert suppliers" on suppliers for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "staff update suppliers" on suppliers;
create policy "staff update suppliers" on suppliers for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete suppliers" on suppliers;
create policy "admin delete suppliers" on suppliers for delete using (my_role_in(factory_id) in ('admin','manager'));

-- purchases
drop policy if exists "members read purchases" on purchases;
create policy "members read purchases" on purchases for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
);
drop policy if exists "staff insert purchases" on purchases;
create policy "staff insert purchases" on purchases for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "staff update purchases" on purchases;
create policy "staff update purchases" on purchases for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete purchases" on purchases;
create policy "admin delete purchases" on purchases for delete using (my_role_in(factory_id) in ('admin','manager'));

-- customer_orders
drop policy if exists "members read orders" on customer_orders;
create policy "members read orders" on customer_orders for select using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
);
drop policy if exists "staff insert orders" on customer_orders;
create policy "staff insert orders" on customer_orders for insert with check (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "staff update orders" on customer_orders;
create policy "staff update orders" on customer_orders for update using (
  factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete orders" on customer_orders;
create policy "admin delete orders" on customer_orders for delete using (my_role_in(factory_id) in ('admin','manager'));

-- production_products, production_batches_v2, machines, machine_status_log,
-- sale_edits: all added by later migrations (update8/update14/update15)
-- rather than the original schema — guarded by to_regclass() so this file
-- applies cleanly regardless of exactly which of those have actually been
-- run against this specific database. Confirmed necessary live: this
-- database is missing sale_edits (update15.sql), so it may be missing
-- others from the same range too — better to check than assume.
do $$
begin
  if to_regclass('public.production_products') is not null then
    execute 'drop policy if exists "members read products" on production_products';
    execute $p$create policy "members read products" on production_products for select using (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
    )$p$;
    execute 'drop policy if exists "staff insert products" on production_products';
    execute $p$create policy "staff insert products" on production_products for insert with check (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'))$p$;
    execute 'drop policy if exists "staff update products" on production_products';
    execute $p$create policy "staff update products" on production_products for update using (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'))$p$;
    execute 'drop policy if exists "admin delete products" on production_products';
    execute $p$create policy "admin delete products" on production_products for delete using (my_role_in(factory_id) in ('admin','manager'))$p$;
  end if;

  if to_regclass('public.production_batches_v2') is not null then
    execute 'drop policy if exists "members read batches v2" on production_batches_v2';
    execute $p$create policy "members read batches v2" on production_batches_v2 for select using (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
    )$p$;
    execute 'drop policy if exists "staff insert batches v2" on production_batches_v2';
    execute $p$create policy "staff insert batches v2" on production_batches_v2 for insert with check (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'))$p$;
    execute 'drop policy if exists "admin delete batches v2" on production_batches_v2';
    execute $p$create policy "admin delete batches v2" on production_batches_v2 for delete using (my_role_in(factory_id) in ('admin','manager'))$p$;
  end if;

  if to_regclass('public.machines') is not null then
    execute 'drop policy if exists "members read machines" on machines';
    execute $p$create policy "members read machines" on machines for select using (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
    )$p$;
    execute 'drop policy if exists "staff insert machines" on machines';
    execute $p$create policy "staff insert machines" on machines for insert with check (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'))$p$;
    execute 'drop policy if exists "staff update machines" on machines';
    execute $p$create policy "staff update machines" on machines for update using (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'))$p$;
    execute 'drop policy if exists "admin delete machines" on machines';
    execute $p$create policy "admin delete machines" on machines for delete using (my_role_in(factory_id) in ('admin','manager'))$p$;
  end if;

  if to_regclass('public.machine_status_log') is not null then
    execute 'drop policy if exists "members read machine status log" on machine_status_log';
    execute $p$create policy "members read machine status log" on machine_status_log for select using (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
    )$p$;
    execute 'drop policy if exists "staff insert machine status log" on machine_status_log';
    execute $p$create policy "staff insert machine status log" on machine_status_log for insert with check (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','manager'))$p$;
  end if;

  if to_regclass('public.sale_edits') is not null then
    execute 'drop policy if exists "members read sale edits" on sale_edits';
    execute $p$create policy "members read sale edits" on sale_edits for select using (
      factory_id in (select my_factory_ids()) and my_role_in(factory_id) <> 'investor'
    )$p$;
  end if;
end $$;

-- ── 1c. Catalog + investor-family tables: widen admin-only writes to
--       admin+manager. Catalog SELECT stays universally readable
--       (low-sensitivity); investor-family SELECT is properly scoped to
--       the caller's own row, replacing the old "anyone but inspecteur"
--       rule (see header note above).
-- ─────────────────────────────────────────────────────────────────

drop policy if exists "admin write flavors" on product_flavors;
create policy "admin write flavors" on product_flavors for insert with check (my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin update flavors" on product_flavors;
create policy "admin update flavors" on product_flavors for update using (my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete flavors" on product_flavors;
create policy "admin delete flavors" on product_flavors for delete using (my_role_in(factory_id) in ('admin','manager'));

drop policy if exists "admin write bulks" on bulk_products;
create policy "admin write bulks" on bulk_products for insert with check (my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin update bulks" on bulk_products;
create policy "admin update bulks" on bulk_products for update using (my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete bulks" on bulk_products;
create policy "admin delete bulks" on bulk_products for delete using (my_role_in(factory_id) in ('admin','manager'));

drop policy if exists "members read investors" on investors;
create policy "members read investors" on investors for select using (
  user_id = auth.uid() or my_role_in(factory_id) in ('admin','manager','vendeur')
);
drop policy if exists "admin write investors" on investors;
create policy "admin write investors" on investors for insert with check (my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin update investors" on investors;
create policy "admin update investors" on investors for update using (my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete investors" on investors;
create policy "admin delete investors" on investors for delete using (my_role_in(factory_id) in ('admin','manager'));

drop policy if exists "members read entries" on investment_entries;
create policy "members read entries" on investment_entries for select using (
  exists (select 1 from investors i where i.id = investment_entries.investor_id and i.user_id = auth.uid())
  or my_role_in(factory_id) in ('admin','manager','vendeur')
);
drop policy if exists "admin write entries" on investment_entries;
create policy "admin write entries" on investment_entries for insert with check (my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin update entries" on investment_entries;
create policy "admin update entries" on investment_entries for update using (my_role_in(factory_id) in ('admin','manager'));
drop policy if exists "admin delete entries" on investment_entries;
create policy "admin delete entries" on investment_entries for delete using (my_role_in(factory_id) in ('admin','manager'));

-- investor_distributions was added by update10.sql, not the original
-- schema — guarded the same way as the production/machines/sale_edits
-- block above, for the same reason.
do $$
begin
  if to_regclass('public.investor_distributions') is not null then
    execute 'drop policy if exists "read distributions" on investor_distributions';
    execute $p$create policy "read distributions" on investor_distributions for select using (
      investor_id in (select id from investors where user_id = auth.uid())
      or my_role_in(factory_id) in ('admin','manager')
    )$p$;
    execute 'drop policy if exists "admin write distributions" on investor_distributions';
    execute $p$create policy "admin write distributions" on investor_distributions for insert with check (
      my_role_in(factory_id) in ('admin','manager')
      and exists (select 1 from investors i where i.id = investor_id and i.factory_id = investor_distributions.factory_id)
    )$p$;
    execute 'drop policy if exists "admin update distributions" on investor_distributions';
    execute $p$create policy "admin update distributions" on investor_distributions for update
      using (my_role_in(factory_id) in ('admin','manager'))
      with check (
        my_role_in(factory_id) in ('admin','manager')
        and exists (select 1 from investors i where i.id = investor_id and i.factory_id = investor_distributions.factory_id)
      )$p$;
    execute 'drop policy if exists "admin delete distributions" on investor_distributions';
    execute $p$create policy "admin delete distributions" on investor_distributions for delete using (my_role_in(factory_id) in ('admin','manager'))$p$;
  end if;
end $$;

-- ── 2. Investor headline report — Reports' restricted view for the
--      investor role reads this instead of the raw tables above.
-- ─────────────────────────────────────────────────────────────────
create or replace function get_investor_headline_report(p_factory_id uuid)
returns table(
  revenue_this_month bigint,
  profit_this_month bigint,
  profit_method text,
  revenue_last_month bigint,
  profit_last_month bigint,
  cash_on_hand bigint
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_this_month text := to_char(now(), 'YYYY-MM');
  v_last_month text := to_char(now() - interval '1 month', 'YYYY-MM');
  v_this_revenue bigint;
  v_this_all_costed boolean;
  v_this_cogs bigint;
  v_this_exp bigint;
  v_this_pur bigint;
  v_this_profit bigint;
  v_this_method text;
  v_last_revenue bigint;
  v_last_all_costed boolean;
  v_last_cogs bigint;
  v_last_exp bigint;
  v_last_pur bigint;
  v_last_profit bigint;
  v_cash bigint;
  v_distributed bigint := 0;
begin
  if not exists (
    select 1 from factory_members
     where factory_id = p_factory_id and user_id = auth.uid()
  ) then
    raise exception 'Accès refusé.';
  end if;

  select coalesce(sum(total_amount), 0),
         (count(*) > 0 and bool_and(cost_amount is not null)),
         coalesce(sum(cost_amount), 0)
    into v_this_revenue, v_this_all_costed, v_this_cogs
    from sales where factory_id = p_factory_id and date like v_this_month || '%';

  select coalesce(sum(amount), 0) into v_this_exp
    from expenses where factory_id = p_factory_id and date like v_this_month || '%';
  select coalesce(sum(total_amount), 0) into v_this_pur
    from purchases where factory_id = p_factory_id and date like v_this_month || '%';

  if v_this_all_costed then
    v_this_method := 'cogs';
    v_this_profit := v_this_revenue - v_this_cogs - v_this_exp;
  else
    v_this_method := 'approx';
    v_this_profit := v_this_revenue - v_this_exp - v_this_pur;
  end if;

  select coalesce(sum(total_amount), 0),
         (count(*) > 0 and bool_and(cost_amount is not null)),
         coalesce(sum(cost_amount), 0)
    into v_last_revenue, v_last_all_costed, v_last_cogs
    from sales where factory_id = p_factory_id and date like v_last_month || '%';

  select coalesce(sum(amount), 0) into v_last_exp
    from expenses where factory_id = p_factory_id and date like v_last_month || '%';
  select coalesce(sum(total_amount), 0) into v_last_pur
    from purchases where factory_id = p_factory_id and date like v_last_month || '%';

  if v_last_all_costed then
    v_last_profit := v_last_revenue - v_last_cogs - v_last_exp;
  else
    v_last_profit := v_last_revenue - v_last_exp - v_last_pur;
  end if;

  -- investor_distributions was added by update10.sql, not the original
  -- schema — this database is already confirmed missing at least one
  -- later-migration table (sale_edits), so this is read defensively
  -- rather than assumed present; a plain reference here would only fail at
  -- call time (every time an investor opens Reports), not at migration
  -- time, since plpgsql doesn't validate table references until executed.
  if to_regclass('public.investor_distributions') is not null then
    execute 'select coalesce(sum(amount), 0) from investor_distributions where factory_id = $1'
      into v_distributed using p_factory_id;
  end if;

  -- Mirrors utils/finance.ts's computeCashOnHand() exactly: collected
  -- (amount_paid if set, else full total for a non-credit sale, else 0 for
  -- an uncollected credit sale) + capital injected − paid to suppliers
  -- (same paid/owed logic) − other expenses − capital distributed out.
  select
    coalesce((
      select sum(case when s.payment_method <> 'credit' then coalesce(s.amount_paid, s.total_amount) else coalesce(s.amount_paid, 0) end)
      from sales s where s.factory_id = p_factory_id
    ), 0)
    + coalesce((select sum(amount) from investment_entries ie where ie.factory_id = p_factory_id), 0)
    - coalesce((
      select sum(case when p.payment_method <> 'credit' then coalesce(p.amount_paid, p.total_amount) else coalesce(p.amount_paid, 0) end)
      from purchases p where p.factory_id = p_factory_id
    ), 0)
    - coalesce((select sum(amount) from expenses e where e.factory_id = p_factory_id), 0)
    - v_distributed
  into v_cash;

  return query select v_this_revenue, v_this_profit, v_this_method, v_last_revenue, v_last_profit, v_cash;
end;
$$;

revoke execute on function get_investor_headline_report(uuid) from public, anon;
grant execute on function get_investor_headline_report(uuid) to authenticated;
