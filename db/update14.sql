-- ============================================================
-- ORNY / SOL Chips — update14
-- Machines domain: lets the factory record the equipment it actually has
-- (name, type, rated capacity, current status) and a history of status
-- changes. Built ahead of real machine data being entered — the point is
-- that once it is, Orny AI can immediately reason about actual-vs-rated
-- capacity (Goldratt's "exploit the constraint") instead of only ever
-- guessing a bottleneck from sales/production/stock numbers alone.
-- Same role posture as production_batches_v2/stock_items: admin/employee
-- write, all members read, vendeur gets nothing extra (inherits no policy
-- here, same as it inherits none on production/stock).
-- Safe to re-run.
-- ============================================================

create table if not exists machines (
  id                uuid primary key default gen_random_uuid(),
  factory_id        uuid not null references factories(id) on delete cascade,
  name              text not null,
  type              text not null default '',
  rated_capacity    numeric,
  capacity_unit     text,
  status            text not null default 'idle' check (status in ('running', 'idle', 'down', 'maintenance')),
  commissioned_date text,
  notes             text,
  created_at        timestamptz not null default now()
);

create index if not exists machines_factory_id_idx on machines(factory_id);

alter table machines enable row level security;

drop policy if exists "members read machines" on machines;
create policy "members read machines"
  on machines for select using (factory_id in (select my_factory_ids()));

drop policy if exists "staff insert machines" on machines;
create policy "staff insert machines"
  on machines for insert with check (
    factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

drop policy if exists "staff update machines" on machines;
create policy "staff update machines"
  on machines for update using (
    factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));

drop policy if exists "admin delete machines" on machines;
create policy "admin delete machines"
  on machines for delete using (my_role_in(factory_id) = 'admin');

-- Append-only status history — no update/delete policy at all, same
-- posture as an audit trail. This is what lets a future runrate-style
-- calculation measure real uptime/downtime instead of only a current
-- snapshot of `machines.status`.
create table if not exists machine_status_log (
  id           uuid primary key default gen_random_uuid(),
  factory_id   uuid not null references factories(id) on delete cascade,
  machine_id   uuid not null references machines(id) on delete cascade,
  status       text not null check (status in ('running', 'idle', 'down', 'maintenance')),
  reason       text,
  created_at   timestamptz not null default now()
);

create index if not exists machine_status_log_machine_id_idx on machine_status_log(machine_id);
create index if not exists machine_status_log_factory_id_idx on machine_status_log(factory_id);

alter table machine_status_log enable row level security;

drop policy if exists "members read machine status log" on machine_status_log;
create policy "members read machine status log"
  on machine_status_log for select using (factory_id in (select my_factory_ids()));

drop policy if exists "staff insert machine status log" on machine_status_log;
create policy "staff insert machine status log"
  on machine_status_log for insert with check (
    factory_id in (select my_factory_ids())
    and my_role_in(factory_id) in ('admin', 'employee'));
