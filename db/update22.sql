-- update22.sql
-- Adds recipe_per_unit to product_flavors and bulk_products — see
-- "Production — produces directly into Saveurs/Lots" in CLAUDE.md.
--
-- Closes a real gap found while building update21.sql's formula feature:
-- Production had its own separate `production_products` catalog, entirely
-- disconnected from the Saveurs/Lots actually sold in Ventes (no shared id
-- anywhere) — producing a batch credited stock nobody could ever sell
-- against, while the flavor/bulk actually sold from never received it.
-- The fix is for Production to produce directly into an existing Saveur or
-- standalone Lot's own stock item, so this is where the formula needs to
-- live now instead — production_products.recipe_per_unit (update21.sql) is
-- left in place, unused, not deleted.
alter table product_flavors add column if not exists recipe_per_unit jsonb not null default '[]';
alter table bulk_products add column if not exists recipe_per_unit jsonb not null default '[]';
