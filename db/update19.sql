-- update19.sql
-- Adds purchases.last_payment_at — timestamp of the most recent payment
-- recorded against a purchase (via recordPurchasePayment(), full or
-- partial). Nothing previously tracked *when* a purchase debt was paid
-- down, only whether/how much (amount_paid) — the Fournisseur detail
-- screen needs a real date to show "Dernier paiement : ...".
-- Additive, nullable: existing rows simply have no recorded payment yet.
alter table purchases add column if not exists last_payment_at timestamptz;
