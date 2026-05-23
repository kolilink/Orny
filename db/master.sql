-- ============================================================
-- ORNY / SOL Chips — Master Schema
-- Run this ONE file in the Supabase SQL Editor.
-- Safe to re-run on any database state (fully idempotent).
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. HELPER FUNCTIONS
-- ════════════════════════════════════════════════════════════

create or replace function generate_invite_code()
returns text language sql
set search_path = public
as $$
  select upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
$$;

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


-- ════════════════════════════════════════════════════════════
-- 2. CORE TABLES
-- ════════════════════════════════════════════════════════════

create table if not exists factories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  currency      text not null default 'GNF',
  weekly_production_target integer not null default 1000,
  stock_alerts  jsonb not null default '{}',
  invite_code   text not null unique default generate_invite_code(),
  created_at    timestamptz not null default now()
);

create table if not exists factory_members (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references factories(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'employee'
                check (role in ('admin', 'employee', 'investor')),
  created_at  timestamptz not null default now(),
  unique(factory_id, user_id)
);

create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

create table if not exists join_requests (
  id            uuid primary key default gen_random_uuid(),
  factory_id    uuid not null references factories(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  user_email    text not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  assigned_role text check (assigned_role in ('admin', 'employee', 'investor')),
  created_at    timestamptz not null default now(),
  unique(factory_id, user_id)
);

create table if not exists sales (
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

create table if not exists production_batches (
  id                 uuid primary key default gen_random_uuid(),
  factory_id         uuid not null references factories(id) on delete cascade,
  date               text not null,
  potatoes_used_kg   numeric not null,
  sachets_80g        integer not null,
  gas_used_kg        numeric not null,
  hours_worked       numeric not null,
  yield_grams_per_kg numeric not null,
  extra_materials    jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists stock_items (
  id              text not null,
  factory_id      uuid not null references factories(id) on delete cascade,
  name            text not null,
  unit            text not null,
  current_level   numeric not null default 0,
  alert_threshold numeric not null,
  last_updated    text not null,
  primary key (factory_id, id)
);

create table if not exists clients (
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

create table if not exists investors (
  id               uuid primary key default gen_random_uuid(),
  factory_id       uuid not null references factories(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete set null,
  name             text not null,
  amount_invested  integer not null,
  share_percentage numeric not null,
  date_added       text not null,
  notes            text,
  created_at       timestamptz not null default now()
);

create table if not exists investment_entries (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references factories(id) on delete cascade,
  investor_id uuid not null references investors(id) on delete cascade,
  amount      integer not null,
  date        text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists product_flavors (
  id            uuid primary key default gen_random_uuid(),
  factory_id    uuid not null references factories(id) on delete cascade,
  label         text not null,
  weight_g      integer not null,
  default_price integer not null,
  created_at    timestamptz not null default now()
);

create table if not exists bulk_products (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references factories(id) on delete cascade,
  name        text not null,
  flavor_id   uuid references product_flavors(id) on delete set null,
  bag_count   integer not null,
  unit_price  integer not null,
  created_at  timestamptz not null default now()
);

create table if not exists business_documents (
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

create table if not exists suppliers (
  id         uuid primary key default gen_random_uuid(),
  factory_id uuid not null references factories(id) on delete cascade,
  name       text not null,
  phone      text,
  product    text not null,
  notes      text,
  created_at timestamptz not null default now()
);

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

create table if not exists invite_lookup_log (
  id         bigserial primary key,
  ip         text not null,
  code_tried text,
  created_at timestamptz default now()
);

create index if not exists invite_lookup_log_ip_time
  on invite_lookup_log (ip, created_at);

create table if not exists production_products (
  id          uuid primary key,
  factory_id  uuid not null references factories(id) on delete cascade,
  name        text not null,
  unit        text not null,
  last_recipe jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

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

create index if not exists production_products_factory_idx on production_products(factory_id);
create index if not exists production_batches_v2_factory_idx on production_batches_v2(factory_id);
create index if not exists production_batches_v2_product_idx on production_batches_v2(product_id);
create index if not exists production_batches_v2_date_idx on production_batches_v2(date desc);


-- ════════════════════════════════════════════════════════════
-- 3. COLUMN MIGRATIONS (safe to run on existing tables)
-- ════════════════════════════════════════════════════════════

alter table investors    add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table profiles     add column if not exists display_name text;

-- ════════════════════════════════════════════════════════════
-- 4. ENABLE ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════

alter table factories          enable row level security;
alter table factory_members    enable row level security;
alter table profiles           enable row level security;
alter table join_requests      enable row level security;
alter table sales              enable row level security;
alter table production_batches enable row level security;
alter table stock_items        enable row level security;
alter table clients            enable row level security;
alter table investors          enable row level security;
alter table investment_entries enable row level security;
alter table product_flavors    enable row level security;
alter table bulk_products      enable row level security;
alter table business_documents enable row level security;
alter table expenses           enable row level security;
alter table suppliers          enable row level security;
alter table purchases          enable row level security;
alter table customer_orders    enable row level security;
alter table production_products   enable row level security;
alter table production_batches_v2 enable row level security;


-- ════════════════════════════════════════════════════════════
-- 5. TRIGGERS
-- ════════════════════════════════════════════════════════════

-- Auto-add factory creator as admin
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

drop trigger if exists on_factory_created on factories;
create trigger on_factory_created
  after insert on factories
  for each row execute procedure handle_factory_created();

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, '')
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Auto-delete invite lookup logs older than 1 hour
create or replace function cleanup_invite_lookup_log()
returns void language sql security definer
set search_path = public
as $$
  delete from invite_lookup_log where created_at < now() - interval '1 hour';
$$;


-- ════════════════════════════════════════════════════════════
-- 6. RPC FUNCTIONS
-- ════════════════════════════════════════════════════════════

create or replace function lookup_factory_by_code(code text)
returns table(id uuid, name text) language sql security definer
set search_path = public
as $$
  select id, name from factories where invite_code = upper(trim(code));
$$;

create or replace function upsert_my_profile(user_email text, user_display_name text default '')
returns void language sql security definer
set search_path = public
as $$
  insert into profiles (id, email, display_name)
  values (auth.uid(), user_email, user_display_name)
  on conflict (id) do update
    set email = excluded.email,
        display_name = case
          when excluded.display_name = '' then profiles.display_name
          else excluded.display_name
        end;
$$;

create or replace function get_my_invite_code(fid uuid)
returns text language sql security definer
set search_path = public
as $$
  select invite_code
  from factories
  where id = fid
    and exists (
      select 1 from factory_members
      where factory_id = fid
        and user_id = auth.uid()
        and role = 'admin'
    );
$$;

create or replace function approve_join_request(req_id uuid, target_role text)
returns void language plpgsql security definer
set search_path = public
as $$
declare
  v_factory_id uuid;
  v_user_id    uuid;
begin
  select factory_id, user_id
    into v_factory_id, v_user_id
    from join_requests
   where id = req_id and status = 'pending';

  if v_factory_id is null then
    raise exception 'join_request not found or already processed';
  end if;

  if not exists (
    select 1 from factory_members
     where factory_id = v_factory_id
       and user_id    = auth.uid()
       and role       = 'admin'
  ) then
    raise exception 'caller is not an admin of this factory';
  end if;

  insert into factory_members (factory_id, user_id, role)
  values (v_factory_id, v_user_id, target_role);

  update join_requests
     set status = 'approved', assigned_role = target_role
   where id = req_id;
end;
$$;


-- ════════════════════════════════════════════════════════════
-- 7. RLS POLICIES
-- ════════════════════════════════════════════════════════════

-- ── FACTORIES ────────────────────────────────────────────────
drop policy if exists "members can read their factory"          on factories;
drop policy if exists "admins can update their factory"         on factories;
drop policy if exists "authenticated users can create a factory" on factories;
drop policy if exists "admins can delete their factory"         on factories;

create policy "members can read their factory"
  on factories for select using (id in (select my_factory_ids()));
create policy "admins can update their factory"
  on factories for update using (my_role_in(id) = 'admin');
create policy "authenticated users can create a factory"
  on factories for insert with check (auth.uid() is not null);
create policy "admins can delete their factory"
  on factories for delete using (my_role_in(id) = 'admin');

-- ── FACTORY MEMBERS ──────────────────────────────────────────
drop policy if exists "members can read their factory's members" on factory_members;
drop policy if exists "admins can add members to their factory"  on factory_members;
drop policy if exists "admins can update member roles"           on factory_members;
drop policy if exists "admins can remove members"               on factory_members;
drop policy if exists "users can join via invite code"          on factory_members;

create policy "members can read their factory's members"
  on factory_members for select using (factory_id in (select my_factory_ids()));
create policy "admins can add members to their factory"
  on factory_members for insert with check (my_role_in(factory_id) = 'admin');
create policy "admins can update member roles"
  on factory_members for update using (my_role_in(factory_id) = 'admin');
create policy "admins can remove members"
  on factory_members for delete using (my_role_in(factory_id) = 'admin');

-- ── PROFILES ─────────────────────────────────────────────────
drop policy if exists "authenticated users can read profiles" on profiles;
drop policy if exists "users can read relevant profiles"      on profiles;
drop policy if exists "users can upsert own profile"          on profiles;
drop policy if exists "users can update own profile"          on profiles;

create policy "users can read relevant profiles"
  on profiles for select using (
    id = auth.uid()
    or id in (
      select user_id from factory_members
       where factory_id in (select my_factory_ids())
    )
  );
create policy "users can upsert own profile"
  on profiles for insert with check (id = auth.uid());
create policy "users can update own profile"
  on profiles for update using (id = auth.uid());

-- ── JOIN REQUESTS ─────────────────────────────────────────────
drop policy if exists "users can create their own request"  on join_requests;
drop policy if exists "users can read their own requests"   on join_requests;
drop policy if exists "users can cancel their pending request" on join_requests;
drop policy if exists "admins can read factory requests"    on join_requests;
drop policy if exists "admins can update factory requests"  on join_requests;

create policy "users can create their own request"
  on join_requests for insert with check (user_id = auth.uid());
create policy "users can read their own requests"
  on join_requests for select using (user_id = auth.uid());
create policy "users can cancel their pending request"
  on join_requests for delete using (user_id = auth.uid() and status = 'pending');
create policy "admins can read factory requests"
  on join_requests for select using (
    factory_id in (
      select factory_id from factory_members
      where user_id = auth.uid() and role = 'admin'
    )
  );
create policy "admins can update factory requests"
  on join_requests for update using (
    factory_id in (
      select factory_id from factory_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- ── SALES ─────────────────────────────────────────────────────
drop policy if exists "members read sales"  on sales;
drop policy if exists "staff insert sales"  on sales;
drop policy if exists "staff update sales"  on sales;
drop policy if exists "admin delete sales"  on sales;

create policy "members read sales"
  on sales for select using (factory_id in (select my_factory_ids()));
create policy "staff insert sales"
  on sales for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update sales"
  on sales for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete sales"
  on sales for delete using (my_role_in(factory_id) = 'admin');

-- ── PRODUCTION BATCHES ────────────────────────────────────────
drop policy if exists "members read production"  on production_batches;
drop policy if exists "staff insert production"  on production_batches;
drop policy if exists "staff update production"  on production_batches;
drop policy if exists "admin delete production"  on production_batches;

create policy "members read production"
  on production_batches for select using (factory_id in (select my_factory_ids()));
create policy "staff insert production"
  on production_batches for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update production"
  on production_batches for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete production"
  on production_batches for delete using (my_role_in(factory_id) = 'admin');

-- ── STOCK ITEMS ───────────────────────────────────────────────
drop policy if exists "members read stock"  on stock_items;
drop policy if exists "staff insert stock"  on stock_items;
drop policy if exists "staff update stock"  on stock_items;
drop policy if exists "admin delete stock"  on stock_items;

create policy "members read stock"
  on stock_items for select using (factory_id in (select my_factory_ids()));
create policy "staff insert stock"
  on stock_items for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update stock"
  on stock_items for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete stock"
  on stock_items for delete using (my_role_in(factory_id) = 'admin');

-- ── CLIENTS ───────────────────────────────────────────────────
drop policy if exists "members read clients"  on clients;
drop policy if exists "staff insert clients"  on clients;
drop policy if exists "staff update clients"  on clients;
drop policy if exists "admin delete clients"  on clients;

create policy "members read clients"
  on clients for select using (factory_id in (select my_factory_ids()));
create policy "staff insert clients"
  on clients for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update clients"
  on clients for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete clients"
  on clients for delete using (my_role_in(factory_id) = 'admin');

-- ── INVESTORS ─────────────────────────────────────────────────
drop policy if exists "members read investors"          on investors;
drop policy if exists "admin write investors"           on investors;
drop policy if exists "admin update investors"          on investors;
drop policy if exists "admin delete investors"          on investors;
drop policy if exists "Investors can read their own record" on investors;

create policy "members read investors"
  on investors for select using (
    user_id = auth.uid() or my_role_in(factory_id) in ('admin','employee'));
create policy "admin write investors"
  on investors for insert with check (my_role_in(factory_id) = 'admin');
create policy "admin update investors"
  on investors for update using (my_role_in(factory_id) = 'admin');
create policy "admin delete investors"
  on investors for delete using (my_role_in(factory_id) = 'admin');

-- ── INVESTMENT ENTRIES ────────────────────────────────────────
drop policy if exists "members read entries"  on investment_entries;
drop policy if exists "admin write entries"   on investment_entries;
drop policy if exists "admin update entries"  on investment_entries;
drop policy if exists "admin delete entries"  on investment_entries;

create policy "members read entries"
  on investment_entries for select using (factory_id in (select my_factory_ids()));
create policy "admin write entries"
  on investment_entries for insert with check (my_role_in(factory_id) = 'admin');
create policy "admin update entries"
  on investment_entries for update using (my_role_in(factory_id) = 'admin');
create policy "admin delete entries"
  on investment_entries for delete using (my_role_in(factory_id) = 'admin');

-- ── PRODUCT FLAVORS ───────────────────────────────────────────
drop policy if exists "members read flavors"  on product_flavors;
drop policy if exists "admin write flavors"   on product_flavors;
drop policy if exists "admin update flavors"  on product_flavors;
drop policy if exists "admin delete flavors"  on product_flavors;

create policy "members read flavors"
  on product_flavors for select using (factory_id in (select my_factory_ids()));
create policy "admin write flavors"
  on product_flavors for insert with check (my_role_in(factory_id) = 'admin');
create policy "admin update flavors"
  on product_flavors for update using (my_role_in(factory_id) = 'admin');
create policy "admin delete flavors"
  on product_flavors for delete using (my_role_in(factory_id) = 'admin');

-- ── BULK PRODUCTS ─────────────────────────────────────────────
drop policy if exists "members read bulks"  on bulk_products;
drop policy if exists "admin write bulks"   on bulk_products;
drop policy if exists "admin update bulks"  on bulk_products;
drop policy if exists "admin delete bulks"  on bulk_products;

create policy "members read bulks"
  on bulk_products for select using (factory_id in (select my_factory_ids()));
create policy "admin write bulks"
  on bulk_products for insert with check (my_role_in(factory_id) = 'admin');
create policy "admin update bulks"
  on bulk_products for update using (my_role_in(factory_id) = 'admin');
create policy "admin delete bulks"
  on bulk_products for delete using (my_role_in(factory_id) = 'admin');

-- ── BUSINESS DOCUMENTS ────────────────────────────────────────
drop policy if exists "members read docs"  on business_documents;
drop policy if exists "staff insert docs"  on business_documents;
drop policy if exists "staff update docs"  on business_documents;
drop policy if exists "admin delete docs"  on business_documents;

create policy "members read docs"
  on business_documents for select using (factory_id in (select my_factory_ids()));
create policy "staff insert docs"
  on business_documents for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update docs"
  on business_documents for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete docs"
  on business_documents for delete using (my_role_in(factory_id) = 'admin');

-- ── EXPENSES ──────────────────────────────────────────────────
drop policy if exists "members read expenses"  on expenses;
drop policy if exists "staff insert expenses"  on expenses;
drop policy if exists "staff update expenses"  on expenses;
drop policy if exists "admin delete expenses"  on expenses;

create policy "members read expenses"
  on expenses for select using (factory_id in (select my_factory_ids()));
create policy "staff insert expenses"
  on expenses for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update expenses"
  on expenses for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete expenses"
  on expenses for delete using (my_role_in(factory_id) = 'admin');

-- ── SUPPLIERS ─────────────────────────────────────────────────
drop policy if exists "members read suppliers"  on suppliers;
drop policy if exists "staff insert suppliers"  on suppliers;
drop policy if exists "staff update suppliers"  on suppliers;
drop policy if exists "admin delete suppliers"  on suppliers;

create policy "members read suppliers"
  on suppliers for select using (factory_id in (select my_factory_ids()));
create policy "staff insert suppliers"
  on suppliers for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update suppliers"
  on suppliers for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete suppliers"
  on suppliers for delete using (my_role_in(factory_id) = 'admin');

-- ── PURCHASES ─────────────────────────────────────────────────
drop policy if exists "members read purchases"  on purchases;
drop policy if exists "staff insert purchases"  on purchases;
drop policy if exists "staff update purchases"  on purchases;
drop policy if exists "admin delete purchases"  on purchases;

create policy "members read purchases"
  on purchases for select using (factory_id in (select my_factory_ids()));
create policy "staff insert purchases"
  on purchases for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update purchases"
  on purchases for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete purchases"
  on purchases for delete using (my_role_in(factory_id) = 'admin');

-- ── CUSTOMER ORDERS ───────────────────────────────────────────
drop policy if exists "members read orders"  on customer_orders;
drop policy if exists "staff insert orders"  on customer_orders;
drop policy if exists "staff update orders"  on customer_orders;
drop policy if exists "admin delete orders"  on customer_orders;

create policy "members read orders"
  on customer_orders for select using (factory_id in (select my_factory_ids()));
create policy "staff insert orders"
  on customer_orders for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update orders"
  on customer_orders for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete orders"
  on customer_orders for delete using (my_role_in(factory_id) = 'admin');

-- ── PRODUCTION PRODUCTS ───────────────────────────────────────
drop policy if exists "members read products"  on production_products;
drop policy if exists "staff insert products"  on production_products;
drop policy if exists "staff update products"  on production_products;
drop policy if exists "admin delete products"  on production_products;

create policy "members read products"
  on production_products for select using (factory_id in (select my_factory_ids()));
create policy "staff insert products"
  on production_products for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "staff update products"
  on production_products for update using (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete products"
  on production_products for delete using (my_role_in(factory_id) = 'admin');

-- ── PRODUCTION BATCHES V2 ─────────────────────────────────────
drop policy if exists "members read batches v2"  on production_batches_v2;
drop policy if exists "staff insert batches v2"  on production_batches_v2;
drop policy if exists "admin delete batches v2"  on production_batches_v2;

create policy "members read batches v2"
  on production_batches_v2 for select using (factory_id in (select my_factory_ids()));
create policy "staff insert batches v2"
  on production_batches_v2 for insert with check (
    factory_id in (select my_factory_ids()) and my_role_in(factory_id) in ('admin','employee'));
create policy "admin delete batches v2"
  on production_batches_v2 for delete using (my_role_in(factory_id) = 'admin');
