-- ============================================================
-- ORNY / SOL Chips — update13
-- Orny AI voice mode: per-user language + autoplay preference.
-- preferred_language is a manual override only — the default (null) means
-- "detect from what the user actually typed/said each time", since a single
-- factory can have members who each speak a different one of the four
-- supported languages (French, Portuguese, Spanish, English). voice_autoplay
-- is off by default for everyone except explicitly enabled — the intended
-- use case is a user who can't read well and needs every reply spoken back
-- automatically, not a default behavior for literate users who'd rather read.
-- Safe to re-run.
-- ============================================================

alter table profiles add column if not exists preferred_language text
  check (preferred_language is null or preferred_language in ('fr', 'pt', 'es', 'en'));

alter table profiles add column if not exists voice_autoplay boolean not null default false;
