BEGIN;

REVOKE INSERT, UPDATE, DELETE ON public.admin_access_requests FROM authenticated;

CREATE OR REPLACE FUNCTION public.request_admin_access()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requester_id uuid := (SELECT auth.uid());
  requester_email text := (SELECT auth.jwt() ->> 'email');
  request_row public.admin_access_requests%ROWTYPE;
BEGIN
  IF requester_id IS NULL
     OR requester_email IS NULL
     OR lower(requester_email) NOT LIKE '%@iskolarngbayan.pup.edu.ph' THEN
    RAISE EXCEPTION 'Verified PUP email required';
  END IF;

  SELECT * INTO request_row
  FROM public.admin_access_requests
  WHERE user_id = requester_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.admin_access_requests (user_id, email, status)
    VALUES (requester_id, requester_email, 'pending');
    RETURN 'pending';
  END IF;

  IF request_row.status = 'rejected'
     OR (request_row.status = 'approved' AND NOT EXISTS (
       SELECT 1 FROM public.admin_users WHERE user_id = requester_id
     )) THEN
    UPDATE public.admin_access_requests
    SET email = requester_email,
        status = 'pending',
        requested_at = now(),
        reviewed_at = NULL,
        reviewed_by = NULL
    WHERE id = request_row.id;
    RETURN 'pending';
  END IF;

  RETURN request_row.status;
END;
$$;

REVOKE ALL ON FUNCTION public.request_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_admin_access() TO authenticated;

COMMIT;