-- ============================================================
-- ORNY / SOL Chips — update24
-- Three additive reconciliation checks, found during a security/data-
-- integrity audit (product-id referential integrity, reconciliation
-- formula coverage) — no schema change, no existing check touched.
-- CREATE OR REPLACE is safe here: run_factory_reconciliation(uuid)'s
-- signature (parameter list) is unchanged from update18_reconciliation.sql,
-- only its body gains three more INSERT blocks before the final
-- `return query`. Safe to re-run.
--
-- Why these three, out of a larger audit: `sales.product`,
-- `purchases.stock_item_id`, `customer_orders.product`, and
-- `production_batches_v2.product_id` are all plain text/uuid columns with
-- NO foreign key to product_flavors/bulk_products/stock_items — the exact
-- same "nothing enforces this actually points at something real" shape
-- that caused the Production/Ventes catalog disconnect fixed earlier (see
-- "Production — produces directly into Saveurs/Lots" in CLAUDE.md). A real
-- FK is a bigger, riskier migration (existing orphaned rows would need
-- cleanup first); a reconciliation check is the cheap, safe first step
-- that at least surfaces it if it happens again.
--
-- Deliberately NOT checked here: `customer_orders.product` (genuinely
-- free text — a customer order can name something not yet in the
-- catalog; screens/CustomerOrders/index.tsx confirms it's a plain
-- TextInput, never a picker) and `production_batches_v2.product_id`
-- (batches logged before the Production/Ventes unification fix point at
-- the now-orphaned `production_products` catalog by design — that's a
-- known, disclosed, unfixable-without-data-loss transition cost, not a
-- bug to keep re-flagging forever).
-- ============================================================

create or replace function run_factory_reconciliation(p_factory_id uuid)
returns table(severity text, check_name text, entity_type text, entity_id text, message text)
language plpgsql security definer
set search_path = public
as $$
begin
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

  -- NEW: a non-credit sale's own store logic (store/sales.ts's addSale,
  -- always called with amountPaid = paymentMethod !== 'credit' ?
  -- totalAmount : 0) makes cash/orange_money always paid in full at
  -- creation, with no "partial payment" path for them anywhere in the
  -- app (unlike credit sales, which legitimately move from 0 toward
  -- total_amount via Clients' own "Paiement partiel"/"mark paid" flows —
  -- so credit sales are deliberately NOT checked here). Any non-credit
  -- sale whose amount_paid has drifted from its own total is a state the
  -- app itself never produces — either a bug, or a sale edited after the
  -- fact to understate what was actually collected.
  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'sale_amount_paid_mismatch', 'sale', s.id::text,
         format('Vente du %s (%s) : montant payé %s ≠ total %s pour un paiement non-crédit', s.date, s.payment_method, coalesce(s.amount_paid, 0), s.total_amount)
  from sales s
  where s.factory_id = p_factory_id
    and s.payment_method <> 'credit'
    and coalesce(s.amount_paid, 0) <> s.total_amount;

  -- NEW: sales.product/product_type have no foreign key to
  -- product_flavors/bulk_products at all (see the file header above) —
  -- this is the cheap detection half of that gap. screens/Ventes/index.tsx
  -- always writes a real flavor.id/bulk.id here (handleTapProduct), so a
  -- sale failing this is either a client bug or points at a
  -- since-renamed/deleted product.
  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'sale_orphaned_product', 'sale', s.id::text,
         format('Vente du %s : produit référencé (%s, %s) introuvable', s.date, s.product, s.product_type)
  from sales s
  where s.factory_id = p_factory_id
    and (
      (s.product_type = 'flavor' and not exists (
        select 1 from product_flavors pf where pf.id::text = s.product and pf.factory_id = p_factory_id
      ))
      or
      (s.product_type = 'bulk' and not exists (
        select 1 from bulk_products bp where bp.id::text = s.product and bp.factory_id = p_factory_id
      ))
    );

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

  -- NEW: purchases.stock_item_id (nullable — an ad-hoc purchase can
  -- legitimately have none) has no foreign key either. When it IS set,
  -- screens/Suppliers/PurchaseFormModal.tsx only ever assigns a real
  -- stock_items.id (a pill picker over real rows, never free text) —
  -- recordStockAddition(stockItemId, ...) silently does nothing useful
  -- if that id doesn't exist, so this is the same "money spent but never
  -- actually landed in stock" class of bug as the cash_on_hand gap this
  -- app has already hit once in Production/Ventes.
  insert into reconciliation_findings (factory_id, severity, check_name, entity_type, entity_id, message)
  select p_factory_id, 'critical', 'purchase_orphaned_stock_item', 'purchase', p.id::text,
         format('Achat du %s (%s) : article de stock référencé introuvable', p.date, p.product)
  from purchases p
  where p.factory_id = p_factory_id
    and p.stock_item_id is not null
    and not exists (
      select 1 from stock_items si where si.id = p.stock_item_id and si.factory_id = p_factory_id
    );

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
  -- No amount_invested-vs-entries drift check here on purpose — see
  -- update18_reconciliation.sql's own note, unchanged, reproduced there.

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

-- ============================================================
-- Security fix: investor_distributions never verified that investor_id
-- actually belongs to the row's own factory_id — only that the caller is
-- an admin of *some* factory matching factory_id. An admin of Factory A
-- could insert/update a distribution with factory_id=A but investor_id
-- pointing at a real investor in Factory B (whose money/records they
-- have no legitimate access to at all), since nothing ever cross-checked
-- the two. Not currently reachable through the app's own UI (Investors'
-- own screen only ever lists/selects investors already scoped to the
-- current factory) — this closes the gap at the RLS layer regardless,
-- the same "don't rely on the client being the only caller" posture
-- every other policy in this schema already takes.
-- ============================================================

drop policy if exists "admin write distributions"  on investor_distributions;
drop policy if exists "admin update distributions" on investor_distributions;

create policy "admin write distributions"
  on investor_distributions for insert with check (
    my_role_in(factory_id) = 'admin'
    and exists (select 1 from investors i where i.id = investor_id and i.factory_id = investor_distributions.factory_id)
  );

-- WITH CHECK added explicitly (previously relied on USING alone, which
-- Postgres reuses for both read-eligibility and the post-update row on an
-- UPDATE policy with no separate WITH CHECK) — so reassigning investor_id
-- to a foreign investor during an edit is blocked the same way creating
-- one from scratch now is.
create policy "admin update distributions"
  on investor_distributions for update
  using (my_role_in(factory_id) = 'admin')
  with check (
    my_role_in(factory_id) = 'admin'
    and exists (select 1 from investors i where i.id = investor_id and i.factory_id = investor_distributions.factory_id)
  );
