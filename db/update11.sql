-- ============================================================
-- ORNY / SOL Chips — update11
-- Business documents (contracts, licences, invoices) used to store
-- only a device-local file:// URI — the actual file never left the
-- phone that uploaded it, so it was unrecoverable on reinstall/loss
-- and invisible to every other device/teammate. This adds a private
-- Supabase Storage bucket + RLS so the file itself is centrally
-- backed up and readable by any member of the same factory.
-- Safe to re-run.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('business-documents', 'business-documents', false)
on conflict (id) do nothing;

alter table business_documents add column if not exists storage_path text;

-- Objects are stored at "<factory_id>/<document_id>.<ext>" — the first
-- path segment is the factory id, so access reuses the same
-- my_factory_ids()/my_role_in() helpers every other table already uses.
drop policy if exists "members read business documents"   on storage.objects;
drop policy if exists "staff upload business documents"   on storage.objects;
drop policy if exists "staff update business documents"   on storage.objects;
drop policy if exists "admin delete business documents"   on storage.objects;

create policy "members read business documents"
  on storage.objects for select using (
    bucket_id = 'business-documents'
    and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
  );

create policy "staff upload business documents"
  on storage.objects for insert with check (
    bucket_id = 'business-documents'
    and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
    and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','employee')
  );

create policy "staff update business documents"
  on storage.objects for update using (
    bucket_id = 'business-documents'
    and (storage.foldername(name))[1]::uuid in (select my_factory_ids())
    and my_role_in((storage.foldername(name))[1]::uuid) in ('admin','employee')
  );

create policy "admin delete business documents"
  on storage.objects for delete using (
    bucket_id = 'business-documents'
    and my_role_in((storage.foldername(name))[1]::uuid) = 'admin'
  );
