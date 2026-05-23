-- update7.sql — invite code lookup rate-limiting log table
-- Run in Supabase SQL Editor after update6.sql

CREATE TABLE IF NOT EXISTS invite_lookup_log (
  id         bigserial PRIMARY KEY,
  ip         text NOT NULL,
  code_tried text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_lookup_log_ip_time
  ON invite_lookup_log (ip, created_at);

-- Auto-delete entries older than 1 hour to keep the table small
CREATE OR REPLACE FUNCTION cleanup_invite_lookup_log()
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  DELETE FROM invite_lookup_log WHERE created_at < now() - interval '1 hour';
$$;
