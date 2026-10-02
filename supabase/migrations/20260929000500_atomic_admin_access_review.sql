BEGIN;

REVOKE UPDATE ON public.admin_access_requests FROM authenticated;
DROP POLICY IF EXISTS "Super admins can review access requests"
ON public.admin_access_requests;

CREATE OR REPLACE FUNCTION public.review_admin_access_request(
  p_request_id uuid,
  p_approve boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_row public.admin_access_requests%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super Admin access required';
  END IF;

  SELECT * INTO request_row
  FROM public.admin_access_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR request_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Admin access request is not pending';
  END IF;

  IF p_approve THEN
    INSERT INTO public.admin_users (user_id, email, role)
    VALUES (request_row.user_id, request_row.email, 'admin')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  UPDATE public.admin_access_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_at = now(),
      reviewed_by = (SELECT auth.uid())
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_admin_access_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_admin_access_request(uuid, boolean) TO authenticated;

COMMIT;