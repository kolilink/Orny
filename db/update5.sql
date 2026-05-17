-- update5.sql  — add user_id to investors table
-- Run in Supabase SQL Editor after update4.sql

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Allow investors to find their own record
CREATE POLICY IF NOT EXISTS "Investors can read their own record"
  ON investors FOR SELECT
  USING (user_id = auth.uid() OR my_role_in(factory_id) IN ('admin', 'employee'));
