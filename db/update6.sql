-- update6.sql — factory delete policy
-- Run in Supabase SQL Editor after update5.sql

CREATE POLICY "admins can delete their factory"
  ON factories FOR DELETE
  USING (my_role_in(id) = 'admin');
