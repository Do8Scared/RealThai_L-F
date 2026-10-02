BEGIN;

ALTER TABLE public.admin_users
ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_users_role_check'
      AND conrelid = 'public.admin_users'::regclass
  ) THEN
    ALTER TABLE public.admin_users
    ADD CONSTRAINT admin_users_role_check
    CHECK (role IN ('admin', 'super_admin'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = (SELECT auth.uid())
      AND role = 'super_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.admin_users FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.admin_users TO authenticated;
GRANT UPDATE (role) ON public.admin_users TO authenticated;

DROP POLICY IF EXISTS "Admins can grant admin roles" ON public.admin_users;
CREATE POLICY "Super admins can grant common admin roles"
ON public.admin_users FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() AND role = 'admin');

DROP POLICY IF EXISTS "Admins can update admin roles" ON public.admin_users;
CREATE POLICY "Super admins can update admin roles"
ON public.admin_users FOR UPDATE TO authenticated
USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Admins can revoke admin roles" ON public.admin_users;
CREATE POLICY "Super admins can revoke admin roles"
ON public.admin_users FOR DELETE TO authenticated
USING (public.is_super_admin());

DROP POLICY IF EXISTS "Admins can review access requests" ON public.admin_access_requests;
CREATE POLICY "Super admins can review access requests"
ON public.admin_access_requests FOR UPDATE TO authenticated
USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Users can request admin access" ON public.admin_access_requests;
CREATE POLICY "Users can request PUP admin access"
ON public.admin_access_requests FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND lower(email) = lower((SELECT auth.jwt() ->> 'email'))
  AND lower(email) LIKE '%@iskolarngbayan.pup.edu.ph'
  AND status = 'pending'
);

DROP POLICY IF EXISTS "Users can read own admin access request" ON public.admin_access_requests;
CREATE POLICY "Users and admins can read admin access requests"
ON public.admin_access_requests FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.is_admin());

ALTER TABLE public.admin_access_requests
DROP CONSTRAINT IF EXISTS admin_access_requests_reviewed_by_fkey;
ALTER TABLE public.admin_access_requests
ADD CONSTRAINT admin_access_requests_reviewed_by_fkey
FOREIGN KEY (reviewed_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL;

ALTER TABLE public.owner_match_requests
DROP CONSTRAINT IF EXISTS owner_match_requests_reviewed_by_fkey;
ALTER TABLE public.owner_match_requests
ADD CONSTRAINT owner_match_requests_reviewed_by_fkey
FOREIGN KEY (reviewed_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.admin_role_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('granted', 'role_changed', 'revoked')),
  previous_role text,
  new_role text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_role_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_role_audit FROM anon, authenticated;
GRANT SELECT ON public.admin_role_audit TO authenticated;

DROP POLICY IF EXISTS "Super admins can read role audit" ON public.admin_role_audit;
CREATE POLICY "Super admins can read role audit"
ON public.admin_role_audit FOR SELECT TO authenticated
USING (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.guard_admin_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  next_role text;
  remaining_super_admins bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    next_role := NULL;
  ELSE
    next_role := NEW.role;
  END IF;

  IF OLD.role = 'super_admin' AND next_role IS DISTINCT FROM 'super_admin' THEN
    PERFORM pg_advisory_xact_lock(hashtext('public.admin_users.super_admin_count')::bigint);
    IF OLD.user_id = (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'A super admin cannot revoke their own role';
    END IF;

    SELECT count(*) INTO remaining_super_admins
    FROM public.admin_users
    WHERE role = 'super_admin' AND user_id <> OLD.user_id;

    IF remaining_super_admins = 0 THEN
      RAISE EXCEPTION 'The last super admin cannot be removed or demoted';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_admin_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.admin_role_audit (actor_user_id, target_user_id, action, new_role)
    VALUES ((SELECT auth.uid()), NEW.user_id, 'granted', NEW.role);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
    INSERT INTO public.admin_role_audit (actor_user_id, target_user_id, action, previous_role, new_role)
    VALUES ((SELECT auth.uid()), NEW.user_id, 'role_changed', OLD.role, NEW.role);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.admin_role_audit (actor_user_id, target_user_id, action, previous_role)
    VALUES ((SELECT auth.uid()), OLD.user_id, 'revoked', OLD.role);
      UPDATE public.admin_access_requests
      SET status = 'rejected', reviewed_at = now(), reviewed_by = (SELECT auth.uid())
      WHERE user_id = OLD.user_id AND status = 'approved';
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_admin_role_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_admin_role_changes() FROM PUBLIC;

DROP TRIGGER IF EXISTS guard_admin_role_changes ON public.admin_users;
CREATE TRIGGER guard_admin_role_changes
BEFORE UPDATE OF role OR DELETE ON public.admin_users
FOR EACH ROW EXECUTE FUNCTION public.guard_admin_role_changes();

DROP TRIGGER IF EXISTS audit_admin_role_changes ON public.admin_users;
CREATE TRIGGER audit_admin_role_changes
AFTER INSERT OR UPDATE OR DELETE ON public.admin_users
FOR EACH ROW EXECUTE FUNCTION public.audit_admin_role_changes();

COMMIT;