BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_announcement_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(20261020, hashtext(NEW.user_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.announcement_requests
    WHERE user_id = NEW.user_id
      AND status IN ('pending_review', 'awaiting_payment', 'payment_submitted')
  ) THEN
    RAISE EXCEPTION 'You already have an announcement request in progress'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_duplicate_active_announcement_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS announcement_requests_prevent_duplicate_active
ON public.announcement_requests;
CREATE TRIGGER announcement_requests_prevent_duplicate_active
BEFORE INSERT ON public.announcement_requests
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_active_announcement_request();

COMMIT;
