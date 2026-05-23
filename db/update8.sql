-- Production rebuild migration
-- Run in Supabase SQL Editor after update7.sql

-- Products table
create table if not exists production_products (
  id           uuid primary key,
  factory_id   uuid not null references factories(id) on delete cascade,
  name         text not null,
  unit         text not null,
  last_recipe  jsonb not null default '[]',
  created_at   timestamptz not null default now()
);

alter table production_products enable row level security;

drop policy if exists "members read products" on production_products;
create policy "members read products"
  on production_products for select
  using (factory_id in (select my_factory_ids()));

drop policy if exists "staff insert products" on production_products;
create policy "staff insert products"
  on production_products for insert
  with check (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));

drop policy if exists "staff update products" on production_products;
create policy "staff update products"
  on production_products for update
  using (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));

drop policy if exists "admin delete products" on production_products;
create policy "admin delete products"
  on production_products for delete
  using (my_role_in(factory_id) = 'admin');

-- New batches table
create table if not exists production_batches_v2 (
  id             uuid primary key,
  factory_id     uuid not null references factories(id) on delete cascade,
  date           date not null,
  product_id     uuid not null,
  product_name   text not null,
  units_produced numeric not null,
  materials_used jsonb not null default '[]',
  energy_used    numeric,
  hours_worked   numeric,
  notes          text,
  created_at     timestamptz not null default now()
);

alter table production_batches_v2 enable row level security;

drop policy if exists "members read batches v2" on production_batches_v2;
create policy "members read batches v2"
  on production_batches_v2 for select
  using (factory_id in (select my_factory_ids()));

drop policy if exists "staff insert batches v2" on production_batches_v2;
create policy "staff insert batches v2"
  on production_batches_v2 for insert
  with check (factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));

drop policy if exists "admin delete batches v2" on production_batches_v2;
create policy "admin delete batches v2"
  on production_batches_v2 for delete
  using (my_role_in(factory_id) = 'admin');

-- Indexes
create index if not exists production_products_factory_idx on production_products(factory_id);
create index if not exists production_batches_v2_factory_idx on production_batches_v2(factory_id);
create index if not exists production_batches_v2_product_idx on production_batches_v2(product_id);
create index if not exists production_batches_v2_date_idx on production_batches_v2(date desc);
