-- ============================================================
-- Schema Update 4 — Run in Supabase SQL Editor
-- Adds: expenses, suppliers, purchases, customer_orders
-- Safe to re-run: uses IF NOT EXISTS
-- ============================================================

-- ─── EXPENSES ────────────────────────────────────────────────
create table if not exists expenses (
  id             uuid primary key default gen_random_uuid(),
  factory_id     uuid not null references factories(id) on delete cascade,
  date           text not null,
  category       text not null check (category in (
                   'loyer','salaire','matiere_premiere','energie',
                   'transport','maintenance','autre')),
  description    text not null default '',
  amount         integer not null,
  payment_method text not null check (payment_method in ('cash', 'orange_money')),
  created_at     timestamptz not null default now()
);

alter table expenses enable row level security;

drop policy if exists "members read expenses"  on expenses;
drop policy if exists "staff insert expenses"  on expenses;
drop policy if exists "staff update expenses"  on expenses;
drop policy if exists "admin delete expenses"  on expenses;

create policy "members read expenses"
  on expenses for select using (factory_id in (select my_factory_ids()));

create policy "staff insert expenses"
  on expenses for insert
  with check (factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

create policy "staff update expenses"
  on expenses for update
  using (factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

create policy "admin delete expenses"
  on expenses for delete using (my_role_in(factory_id) = 'admin');

-- ─── SUPPLIERS ───────────────────────────────────────────────
create table if not exists suppliers (
  id         uuid primary key default gen_random_uuid(),
  factory_id uuid not null references factories(id) on delete cascade,
  name       text not null,
  phone      text,
  product    text not null,
  notes      text,
  created_at timestamptz not null default now()
);

alter table suppliers enable row level security;

drop policy if exists "members read suppliers"  on suppliers;
drop policy if exists "staff insert suppliers"  on suppliers;
drop policy if exists "staff update suppliers"  on suppliers;
drop policy if exists "admin delete suppliers"  on suppliers;

create policy "members read suppliers"
  on suppliers for select using (factory_id in (select my_factory_ids()));

create policy "staff insert suppliers"
  on suppliers for insert
  with check (factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

create policy "staff update suppliers"
  on suppliers for update
  using (factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

create policy "admin delete suppliers"
  on suppliers for delete using (my_role_in(factory_id) = 'admin');

-- ─── PURCHASES ───────────────────────────────────────────────
create table if not exists purchases (
  id             uuid primary key default gen_random_uuid(),
  factory_id     uuid not null references factories(id) on delete cascade,
  supplier_id    uuid references suppliers(id) on delete set null,
  supplier_name  text not null,
  date           text not null,
  product        text not null,
  quantity       numeric not null,
  unit           text not null,
  unit_price     integer not null,
  total_amount   integer not null,
  payment_method text not null check (payment_method in ('cash', 'orange_money', 'credit')),
  notes          text,
  created_at     timestamptz not null default now()
);

alter table purchases enable row level security;

drop policy if exists "members read purchases"  on purchases;
drop policy if exists "staff insert purchases"  on purchases;
drop policy if exists "staff update purchases"  on purchases;
drop policy if exists "admin delete purchases"  on purchases;

create policy "members read purchases"
  on purchases for select using (factory_id in (select my_factory_ids()));

create policy "staff insert purchases"
  on purchases for insert
  with check (factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

create policy "staff update purchases"
  on purchases for update
  using (factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

create policy "admin delete purchases"
  on purchases for delete using (my_role_in(factory_id) = 'admin');

-- ─── CUSTOMER ORDERS ─────────────────────────────────────────
create table if not exists customer_orders (
  id             uuid primary key default gen_random_uuid(),
  factory_id     uuid not null references factories(id) on delete cascade,
  client_name    text not null,
  product        text not null,
  quantity       integer not null,
  unit_price     integer not null,
  total_amount   integer not null,
  delivery_date  text not null,
  status         text not null default 'pending'
                   check (status in ('pending', 'ready', 'delivered', 'cancelled')),
  notes          text,
  created_at     timestamptz not null default now()
);

alter table customer_orders enable row level security;

drop policy if exists "members read orders"    on customer_orders;
drop policy if exists "staff insert orders"    on customer_orders;
drop policy if exists "staff update orders"    on customer_orders;
drop policy if exists "admin delete orders"    on customer_orders;

create policy "members read orders"
  on customer_orders for select using (factory_id in (select my_factory_ids()));

create policy "staff insert orders"
  on customer_orders for insert
  with check (factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

create policy "staff update orders"
  on customer_orders for update
  using (factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

create policy "admin delete orders"
  on customer_orders for delete using (my_role_in(factory_id) = 'admin');
