-- ============================================================
-- ORNY / SOL Chips — update18_reconciliation
-- Data-integrity reconciliation, Patron-style: a fixed set of SQL
-- checks that re-derive facts from the raw tables and flag anywhere
-- they disagree with a stored/computed value, so a bug or a bad
-- manual edit shows up as a named finding instead of silently
-- shipping a wrong number to Reports/Coach/Dashboard. Safe to re-run.
--
-- Scoped to what this schema can actually support today. Orny has no
-- append-only stock-movement ledger (unlike Patron's stock_moves) —
-- stock_items.current_level is a running total with nothing to replay
-- it against — so "does stock match its own history" isn't a check
-- that can exist yet; building that ledger is real, separate scope
-- (every sale/purchase/production-batch write site would need it),
-- not something to bolt on inside a reconciliation pass. What IS
-- checkable without any new ledger: row-level arithmetic (does a
-- stored total match qty*price), and per-entity aggregate drift
-- (does a cached summary field match the sum of its own raw rows).
-- ============================================================

create table if not exists reconciliation_findings (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references factories(id) on delete cascade,
  run_at      timestamptz not null default now(),
  severity    text not null check (severity in ('critical', 'warning')),
  check_name  text not null,
  entity_type text not null,
  entity_id   text,
  message     text not null
);
create index if not exists reconciliation_findings_factory_idx
  on reconciliation_findings (factory_id, run_at desc);

alter table reconciliation_findings enable row level security;
drop policy if exists "admins read reconciliation findings" on reconciliation_findings;
create policy "admins read reconciliation findings"
  on reconciliation_findings for select using (my_role_in(factory_id) = 'admin');
-- No insert/update/delete policy for any client role — only
-- run_factory_reconciliation() (SECURITY DEFINER below) writes here,
-- the same "nobody, including admin, writes directly" posture
-- update15.sql already uses for sale_edits/investment_entry_edits.

create or replace function run_factory_reconciliation(p_factory_id uuid)
returns table(severity text, check_name text, entity_type text, entity_id text, message text)
language plpgsql security definer
set search_path = public
as $$
begin
  -- NOT EXISTS, not "my_role_in(...) <> 'admin'" — the latter is NULL
  -- (not TRUE) for a non-member, and "if NULL then raise" is silently
  -- skipped in PL/pgSQL, the exact NULL-bypass bug class documented in
  -- the sibling Patron app's CLAUDE.md. This function is SECURITY
  -- DEFINER and its own RETURN QUERY reads reconciliation_findings
  -- with RLS bypassed (definer functions don't inherit caller RLS
  -- internally) — a broken guard here would let any authenticated
  -- user pull another factory's sales/investor figures by passing an
  -- arbitrary p_factory_id, not just fail to double-check a role.
  if not exists (
    select 1 from factory_members
    where factory_id = p_factory_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Seul un administrateur peut lancer une vérification des données.';
  end if;

  delete from reconciliation_findings where factory_id = p_factory_id;

  -- ── SALES ──────────────────────────────────────────────────────
  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'sale_total_mismatch', 'sale', s.id::text,
         format('Vente du %s : total enregistré %s ≠ quantité×prix %s', s.date, s.total_amount, s.quantity * s.unit_price)
  from sales s
  where s.factory_id = p_factory_id and s.total_amount <> s.quantity * s.unit_price;

  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'sale_overpaid', 'sale', s.id::text,
         format('Vente du %s : montant payé %s > total %s', s.date, s.amount_paid, s.total_amount)
  from sales s
  where s.factory_id = p_factory_id and s.amount_paid is not null and s.amount_paid > s.total_amount;

  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'sale_invalid_values', 'sale', s.id::text,
         format('Vente du %s : quantité ou prix invalide (qté %s, prix %s)', s.date, s.quantity, s.unit_price)
  from sales s
  where s.factory_id = p_factory_id and (s.quantity <= 0 or s.unit_price < 0 or s.total_amount < 0);

  -- ── PURCHASES ──────────────────────────────────────────────────
  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'purchase_total_mismatch', 'purchase', p.id::text,
         format('Achat du %s (%s) : total enregistré %s ≠ quantité×prix %s', p.date, p.product, p.total_amount, round(p.quantity * p.unit_price))
  from purchases p
  where p.factory_id = p_factory_id and p.total_amount <> round(p.quantity * p.unit_price);

  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'purchase_invalid_values', 'purchase', p.id::text,
         format('Achat du %s (%s) : quantité ou prix invalide (qté %s, prix %s)', p.date, p.product, p.quantity, p.unit_price)
  from purchases p
  where p.factory_id = p_factory_id and (p.quantity <= 0 or p.unit_price < 0 or p.total_amount < 0);

  -- ── CUSTOMER ORDERS ────────────────────────────────────────────
  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'warning', 'order_total_mismatch', 'customer_order', co.id::text,
         format('Commande du %s (%s) : total enregistré %s ≠ quantité×prix %s', co.delivery_date, co.client_name, co.total_amount, co.quantity * co.unit_price)
  from customer_orders co
  where co.factory_id = p_factory_id and co.total_amount <> co.quantity * co.unit_price;

  -- ── STOCK ──────────────────────────────────────────────────────
  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'stock_negative', 'stock_item', si.id,
         format('Stock "%s" : niveau négatif (%s %s)', si.name, si.current_level, si.unit)
  from stock_items si
  where si.factory_id = p_factory_id and si.current_level < 0;

  -- ── EXPENSES ───────────────────────────────────────────────────
  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'expense_invalid_amount', 'expense', e.id::text,
         format('Dépense du %s (%s) : montant invalide (%s)', e.date, e.category, e.amount)
  from expenses e
  where e.factory_id = p_factory_id and e.amount <= 0;

  -- ── INVESTORS ──────────────────────────────────────────────────
  -- No amount_invested-vs-entries drift check here on purpose: it looks
  -- like a cached-snapshot-vs-ledger check (the shape every other check
  -- in this function is), but it isn't one. screens/Investors/index.tsx's
  -- handleSaveInvestor() deliberately writes the typed "initial amount"
  -- into a real investment_entries row, THEN zeroes investors.amount_invested
  -- right back to 0 in the same flow — 0 vs a real entries sum is the
  -- correct, intended terminal state for every investor created this way,
  -- not drift. A first version of this migration had exactly this check
  -- and it fired a false positive against real production data the first
  -- time it ran (a real investor, amount_invested=0, entries summing to
  -- 4,653,000 GNF) — caught by actually running it against prod before
  -- calling this done, not by re-reading the SQL. Left out rather than
  -- "fixed", since amount_invested has no invariant left to check once
  -- you know its real lifecycle: it's a legacy field that only matters
  -- for whatever value it held before investment_entries existed.

  -- An investor paid out more than they ever put in. Can be legitimate
  -- (profit share), but it's exactly the pattern worth a human glance —
  -- same posture as Patron's check #77 for capital injections/withdrawals.
  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'warning', 'investor_distributions_exceed_contributions', 'investor', i.id::text,
         format('Investisseur %s : retraits cumulés %s > apports cumulés %s', i.name, coalesce(dist_totals.amount, 0), coalesce(entry_totals.amount, 0))
  from investors i
  left join (select investor_id, sum(amount) as amount from investor_distributions group by investor_id) dist_totals on dist_totals.investor_id = i.id
  left join (select investor_id, sum(amount) as amount from investment_entries group by investor_id) entry_totals on entry_totals.investor_id = i.id
  where i.factory_id = p_factory_id
    and coalesce(dist_totals.amount, 0) > coalesce(entry_totals.amount, 0);

  return query
  select f.severity, f.check_name, f.entity_type, f.entity_id, f.message
  from reconciliation_findings f
  where f.factory_id = p_factory_id
  order by (f.severity = 'critical') desc, f.check_name;
end;
$$;

revoke execute on function run_factory_reconciliation(uuid) from public, anon;
grant execute on function run_factory_reconciliation(uuid) to authenticated;
