BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.admin_users(user_id)
);

CREATE TABLE IF NOT EXISTS public.claim_followup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  post_number bigint,
  item_title text NOT NULL,
  campus text,
  claimant_email text NOT NULL,
  poster_name text NOT NULL,
  poster_contact text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_match_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  post_number bigint,
  item_title text NOT NULL,
  campus text,
  likely_owner text NOT NULL,
  proof text NOT NULL,
  contact text NOT NULL,
  evidence_image text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.admin_users(user_id)
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_followup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_match_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_access_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_followup_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_match_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.is_admin()
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
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DROP POLICY IF EXISTS "Admins can read admin roles" ON public.admin_users;
CREATE POLICY "Admins can read admin roles"
ON public.admin_users FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS "Admins can grant admin roles" ON public.admin_users;
CREATE POLICY "Admins can grant admin roles"
ON public.admin_users FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update admin roles" ON public.admin_users;
CREATE POLICY "Admins can update admin roles"
ON public.admin_users FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can revoke admin roles" ON public.admin_users;
CREATE POLICY "Admins can revoke admin roles"
ON public.admin_users FOR DELETE TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "Users can read own admin access request" ON public.admin_access_requests;
CREATE POLICY "Users can read own admin access request"
ON public.admin_access_requests FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS "Users can request admin access" ON public.admin_access_requests;
CREATE POLICY "Users can request admin access"
ON public.admin_access_requests FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND lower(email) = lower((SELECT auth.jwt() ->> 'email'))
  AND status = 'pending'
);

DROP POLICY IF EXISTS "Admins can review access requests" ON public.admin_access_requests;
CREATE POLICY "Admins can review access requests"
ON public.admin_access_requests FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users and admins can read claim follow-ups" ON public.claim_followup_requests;
CREATE POLICY "Users and admins can read claim follow-ups"
ON public.claim_followup_requests FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS "Users can submit own claim follow-ups" ON public.claim_followup_requests;
CREATE POLICY "Users can submit own claim follow-ups"
ON public.claim_followup_requests FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND claimant_email = (SELECT auth.jwt() ->> 'email')
  AND status = 'pending'
);

DROP POLICY IF EXISTS "Admins can update claim follow-ups" ON public.claim_followup_requests;
CREATE POLICY "Admins can update claim follow-ups"
ON public.claim_followup_requests FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users and admins can read owner match requests" ON public.owner_match_requests;
CREATE POLICY "Users and admins can read owner match requests"
ON public.owner_match_requests FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS "Users can submit own owner match requests" ON public.owner_match_requests;
CREATE POLICY "Users can submit own owner match requests"
ON public.owner_match_requests FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'pending');

DROP POLICY IF EXISTS "Admins can review owner match requests" ON public.owner_match_requests;
CREATE POLICY "Admins can review owner match requests"
ON public.owner_match_requests FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMIT;