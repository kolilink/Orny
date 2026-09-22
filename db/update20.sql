-- update20.sql
-- Adds sales.created_by — the auth user who recorded the sale. Nothing
-- previously tracked *who* made a sale, only what/when/how much; the
-- redesigned sale history screen (screens/Ventes/History.tsx, matching
-- Patron's own sales-history pattern) shows "Vendeur : X", resolved from
-- factory_members/profiles the same way FactorySettings already resolves
-- member display names (see AuthContext.getMembers()).
-- Additive, nullable: existing rows simply have no recorded seller and the
-- app already renders that as "no vendor line" rather than a placeholder.
alter table sales add column if not exists created_by uuid references auth.users(id);
