-- ============================================================
-- ORNY / SOL Chips — update28
-- Multi-currency investor contributions ("apports") — a US-based investor
-- sends USD, others send GNF directly, neither should have to do the
-- conversion math by hand. investment_entries.amount stays GNF (the
-- business's own currency, unchanged) — these three columns are purely
-- additive record-keeping on top of it: what currency was actually typed,
-- what the raw typed amount was in that currency, and what rate converted
-- it. currency defaults 'GNF' so every existing row (and any future insert
-- that never sets these) reads as "GNF, no conversion happened" — the
-- correct, honest default, not a guess. Safe to re-run.
-- ============================================================

alter table investment_entries add column if not exists currency text not null default 'GNF';
alter table investment_entries add column if not exists original_amount numeric;
alter table investment_entries add column if not exists exchange_rate numeric;

alter table investment_entries drop constraint if exists investment_entries_currency_check;
alter table investment_entries add constraint investment_entries_currency_check
  check (currency in ('GNF', 'USD'));
