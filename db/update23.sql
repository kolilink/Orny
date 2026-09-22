-- ============================================================
-- ORNY / SOL Chips — update23
-- Expense receipt photo. The "Nouvelle dépense" form (screens/Expenses)
-- was simplified down to its core (amount, description, date, photo — see
-- CLAUDE.md "Expenses simplified again — matching Patron's own form"), and
-- "photo" is a genuinely new field, not a restyle of an existing one. Same
-- private-bucket-per-feature pattern update11.sql already established for
-- business_documents — a dedicated "expense-receipts" bucket, not a reuse
-- of "business-documents", so receipts stay out of that bucket's own
-- (differently-shaped) file-type/category concerns.
-- Safe to re-run.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do nothing;

alter table expenses add column if not exists photo_storage_path text;

-- Objects are stored at "<factory_id>/<expense_id>.jpg" — same
-- my_factory_ids()/my_role_in() gate every other table/bucket already uses.
-- Role gate mirrors "staff insert expenses"/"staff update expenses" below
-- (admin/employee) and "admin delete expenses" (admin only).
drop policy if exists "members read expense receipts"  on storage.objects;
drop policy if exists "staff upload expense receipts"  on storage.objects;
drop policy if exists "staff update expense receipts"  on storage.objects;
drop policy if exists "admin delete expense receipts"  on storage.objects;

create policy "members read expense receipts"
  on storage.objects for select using (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
  );

create policy "staff upload expense receipts"
  on storage.objects for insert with check (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
    and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','employee')
  );

create policy "staff update expense receipts"
  on storage.objects for update using (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
    and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','employee')
  );

create policy "admin delete expense receipts"
  on storage.objects for delete using (
    bucket_id = 'expense-receipts'
    and my_role_in((storage.foldername(name))[1]::uuid) = 'admin'
  );
