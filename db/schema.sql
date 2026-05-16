-- ============================================================
-- SOL Chips / Corning — Supabase Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- ─── HELPER: generate a random 8-char invite code ───────────
create or replace function generate_invite_code()
returns text language sql
set search_path = public
as $$
  select upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
$$;

-- ─── FACTORIES ───────────────────────────────────────────────
create table factories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  currency      text not null default 'GNF',
  weekly_production_target integer not null default 1000,
  stock_alerts  jsonb not null default '{}',
  invite_code   text not null unique default generate_invite_code(),
  created_at    timestamptz not null default now()
);

-- ─── FACTORY MEMBERS (users ↔ factories) ─────────────────────
create table factory_members (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references factories(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'employee'
                check (role in ('admin', 'employee', 'investor')),
  created_at  timestamptz not null default now(),
  unique(factory_id, user_id)
);

-- ─── SALES ───────────────────────────────────────────────────
create table sales (
  id             uuid primary key default gen_random_uuid(),
  factory_id     uuid not null references factories(id) on delete cascade,
  date           text not null,
  client_name    text not null,
  product        text not null,
  product_type   text check (product_type in ('flavor', 'bulk')),
  quantity       integer not null,
  unit_price     integer not null,
  total_amount   integer not null,
  amount_paid    integer,
  payment_method text not null check (payment_method in ('cash', 'orange_money', 'credit')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ─── PRODUCTION BATCHES ──────────────────────────────────────
create table production_batches (
  id                uuid primary key default gen_random_uuid(),
  factory_id        uuid not null references factories(id) on delete cascade,
  date              text not null,
  potatoes_used_kg  numeric not null,
  sachets_80g       integer not null,
  gas_used_kg       numeric not null,
  hours_worked      numeric not null,
  yield_grams_per_kg numeric not null,
  extra_materials   jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ─── STOCK ITEMS ─────────────────────────────────────────────
create table stock_items (
  id              text not null,
  factory_id      uuid not null references factories(id) on delete cascade,
  name            text not null,
  unit            text not null,
  current_level   numeric not null default 0,
  alert_threshold numeric not null,
  last_updated    text not null,
  primary key (factory_id, id)
);

-- ─── CLIENTS ─────────────────────────────────────────────────
create table clients (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references factories(id) on delete cascade,
  name        text not null,
  phone       text,
  location    text,
  type        text,
  latitude    numeric,
  longitude   numeric,
  created_at  timestamptz not null default now()
);

-- ─── INVESTORS ───────────────────────────────────────────────
create table investors (
  id               uuid primary key default gen_random_uuid(),
  factory_id       uuid not null references factories(id) on delete cascade,
  name             text not null,
  amount_invested  integer not null,
  share_percentage numeric not null,
  date_added       text not null,
  notes            text,
  created_at       timestamptz not null default now()
);

-- ─── INVESTMENT ENTRIES ───────────────────────────────────────
create table investment_entries (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references factories(id) on delete cascade,
  investor_id uuid not null references investors(id) on delete cascade,
  amount      integer not null,
  date        text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ─── PRODUCT FLAVORS ─────────────────────────────────────────
create table product_flavors (
  id            uuid primary key default gen_random_uuid(),
  factory_id    uuid not null references factories(id) on delete cascade,
  label         text not null,
  weight_g      integer not null,
  default_price integer not null,
  created_at    timestamptz not null default now()
);

-- ─── BULK PRODUCTS ───────────────────────────────────────────
create table bulk_products (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references factories(id) on delete cascade,
  name        text not null,
  flavor_id   uuid references product_flavors(id) on delete set null,
  bag_count   integer not null,
  unit_price  integer not null,
  created_at  timestamptz not null default now()
);

-- ─── BUSINESS DOCUMENTS ──────────────────────────────────────
create table business_documents (
  id              uuid primary key default gen_random_uuid(),
  factory_id      uuid not null references factories(id) on delete cascade,
  title           text not null,
  category        text not null check (category in ('contrat','facture','licence','import_export','investisseur','autre')),
  file_uri        text not null,
  file_type       text not null check (file_type in ('image','pdf')),
  notes           text not null default '',
  date_added      text not null,
  tags            text[] not null default '{}',
  expiration_date text,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table factories         enable row level security;
alter table factory_members   enable row level security;
alter table sales             enable row level security;
alter table production_batches enable row level security;
alter table stock_items       enable row level security;
alter table clients           enable row level security;
alter table investors         enable row level security;
alter table investment_entries enable row level security;
alter table product_flavors   enable row level security;
alter table bulk_products     enable row level security;
alter table business_documents enable row level security;

-- ─── HELPER VIEW: which factories does the current user belong to? ───
-- Used inside policies to avoid N+1 subqueries
create or replace function my_factory_ids()
returns setof uuid language sql security definer
set search_path = public
as $$
  select factory_id from factory_members where user_id = auth.uid();
$$;

create or replace function my_role_in(fid uuid)
returns text language sql security definer
set search_path = public
as $$
  select role from factory_members
  where user_id = auth.uid() and factory_id = fid
  limit 1;
$$;

-- ─── FACTORIES policies ──────────────────────────────────────
create policy "members can read their factory"
  on factories for select
  using (id in (select my_factory_ids()));

create policy "admins can update their factory"
  on factories for update
  using (my_role_in(id) = 'admin');

-- anyone authenticated can create a factory (they become admin via trigger below)
create policy "authenticated users can create a factory"
  on factories for insert
  with check (auth.uid() is not null);

-- ─── AUTO-ADD CREATOR AS ADMIN ───────────────────────────────
create or replace function handle_factory_created()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into factory_members (factory_id, user_id, role)
  values (new.id, auth.uid(), 'admin');
  return new;
end;
$$;

create trigger on_factory_created
  after insert on factories
  for each row execute procedure handle_factory_created();

-- ─── FACTORY MEMBERS policies ────────────────────────────────
create policy "members can read their factory's members"
  on factory_members for select
  using (factory_id in (select my_factory_ids()));

create policy "admins can add members to their factory"
  on factory_members for insert
  with check (my_role_in(factory_id) = 'admin');

create policy "admins can update member roles"
  on factory_members for update
  using (my_role_in(factory_id) = 'admin');

create policy "admins can remove members"
  on factory_members for delete
  using (my_role_in(factory_id) = 'admin');

-- ─── DATA TABLE POLICIES (sales, production, stock, etc.) ────
-- Pattern: members can read; admins+employees can write; investors read-only

-- SALES
create policy "members read sales"      on sales for select using (factory_id in (select my_factory_ids()));
create policy "staff insert sales"      on sales for insert with check (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update sales"      on sales for update using (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete sales"      on sales for delete using (my_role_in(factory_id) = 'admin');

-- PRODUCTION BATCHES
create policy "members read production"  on production_batches for select using (factory_id in (select my_factory_ids()));
create policy "staff insert production"  on production_batches for insert with check (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update production"  on production_batches for update using (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete production"  on production_batches for delete using (my_role_in(factory_id) = 'admin');

-- STOCK ITEMS
create policy "members read stock"       on stock_items for select using (factory_id in (select my_factory_ids()));
create policy "staff insert stock"       on stock_items for insert with check (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update stock"       on stock_items for update using (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete stock"       on stock_items for delete using (my_role_in(factory_id) = 'admin');

-- CLIENTS
create policy "members read clients"     on clients for select using (factory_id in (select my_factory_ids()));
create policy "staff insert clients"     on clients for insert with check (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update clients"     on clients for update using (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete clients"     on clients for delete using (my_role_in(factory_id) = 'admin');

-- INVESTORS
create policy "members read investors"   on investors for select using (factory_id in (select my_factory_ids()));
create policy "admin write investors"    on investors for insert with check (my_role_in(factory_id) = 'admin');
create policy "admin update investors"   on investors for update using (my_role_in(factory_id) = 'admin');
create policy "admin delete investors"   on investors for delete using (my_role_in(factory_id) = 'admin');

-- INVESTMENT ENTRIES
create policy "members read entries"    on investment_entries for select using (factory_id in (select my_factory_ids()));
create policy "admin write entries"     on investment_entries for insert with check (my_role_in(factory_id) = 'admin');
create policy "admin update entries"    on investment_entries for update using (my_role_in(factory_id) = 'admin');
create policy "admin delete entries"    on investment_entries for delete using (my_role_in(factory_id) = 'admin');

-- PRODUCT FLAVORS
create policy "members read flavors"    on product_flavors for select using (factory_id in (select my_factory_ids()));
create policy "admin write flavors"     on product_flavors for insert with check (my_role_in(factory_id) = 'admin');
create policy "admin update flavors"    on product_flavors for update using (my_role_in(factory_id) = 'admin');
create policy "admin delete flavors"    on product_flavors for delete using (my_role_in(factory_id) = 'admin');

-- BULK PRODUCTS
create policy "members read bulks"      on bulk_products for select using (factory_id in (select my_factory_ids()));
create policy "admin write bulks"       on bulk_products for insert with check (my_role_in(factory_id) = 'admin');
create policy "admin update bulks"      on bulk_products for update using (my_role_in(factory_id) = 'admin');
create policy "admin delete bulks"      on bulk_products for delete using (my_role_in(factory_id) = 'admin');

-- BUSINESS DOCUMENTS
create policy "members read docs"       on business_documents for select using (factory_id in (select my_factory_ids()));
create policy "staff insert docs"       on business_documents for insert with check (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update docs"       on business_documents for update using (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete docs"       on business_documents for delete using (my_role_in(factory_id) = 'admin');
