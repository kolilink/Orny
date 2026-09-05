-- ============================================================
-- update9_security_fix.sql — Security hardening
-- Run in Supabase SQL Editor (safe to re-run, idempotent)
-- ============================================================

-- ─── 1. FIX: upsert_my_profile — restore SET search_path ─────
-- schema_update2.sql stripped this directive. Restore it.
CREATE OR REPLACE FUNCTION public.upsert_my_profile(user_email text, user_display_name text DEFAULT '')
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  INSERT INTO profiles (id, email, display_name)
  VALUES (auth.uid(), user_email, user_display_name)
  ON CONFLICT (id) DO UPDATE
    SET email = excluded.email,
        display_name = CASE
          WHEN excluded.display_name = '' THEN profiles.display_name
          ELSE excluded.display_name
        END;
$$;

-- Also fix handle_new_user which schema_update2.sql also stripped
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (new.id, new.email, '')
  ON CONFLICT (id) DO UPDATE
    SET email = excluded.email;
  RETURN new;
END;
$$;


-- ─── 2. FIX: Revoke from PUBLIC, then re-grant where needed ──
--
-- The root issue: Supabase grants EXECUTE to PUBLIC by default.
-- anon and authenticated both inherit from PUBLIC, so revoking
-- from those roles alone doesn't remove the PUBLIC grant.
-- The correct pattern: REVOKE FROM PUBLIC, then GRANT back only
-- to the roles that legitimately need the function.
--
-- lookup_factory_by_code: anon needs it (pre-login factory lookup)
REVOKE EXECUTE ON FUNCTION public.lookup_factory_by_code(text)         FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.lookup_factory_by_code(text)         TO anon, authenticated;

-- Functions only authenticated users should call
REVOKE EXECUTE ON FUNCTION public.approve_join_request(uuid, text)     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.approve_join_request(uuid, text)     TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_invite_code(uuid)             FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_invite_code(uuid)             TO authenticated;

REVOKE EXECUTE ON FUNCTION public.my_factory_ids()                     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_factory_ids()                     TO authenticated;

REVOKE EXECUTE ON FUNCTION public.my_role_in(uuid)                     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_role_in(uuid)                     TO authenticated;

REVOKE EXECUTE ON FUNCTION public.upsert_my_profile(text, text)        FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.upsert_my_profile(text, text)        TO authenticated;

-- Handle single-arg overload if it exists as a separate function
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.upsert_my_profile(text) FROM PUBLIC;
  GRANT  EXECUTE ON FUNCTION public.upsert_my_profile(text) TO authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- Trigger-only and internal utility: no one calls these via RPC
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_factory_created()             FROM PUBLIC;

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ─── 3. FIX: cleanup_invite_lookup_log ───────────────────────
-- Anon could call this to erase rate-limit records and brute-force
-- invite codes. Revoke from PUBLIC entirely — no role should call
-- this via the REST API. Schedule it via pg_cron (see below).
REVOKE EXECUTE ON FUNCTION public.cleanup_invite_lookup_log()          FROM PUBLIC;


-- ─── 4. invite_lookup_log no-policy warning (already fixed) ──
-- Keeping this here so it's still idempotent if re-run.
DROP POLICY IF EXISTS "no direct access" ON public.invite_lookup_log;
CREATE POLICY "no direct access"
  ON public.invite_lookup_log
  USING (false);


-- ─── 5. OPTIONAL: Schedule cleanup via pg_cron ───────────────
-- If pg_cron is enabled (Supabase Pro+), uncomment to auto-clean
-- the rate-limit log every hour.

-- SELECT cron.schedule(
--   'cleanup-invite-lookup-log',
--   '0 * * * *',
--   $$ SELECT public.cleanup_invite_lookup_log(); $$
-- );
