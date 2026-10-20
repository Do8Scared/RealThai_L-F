BEGIN;

ALTER TABLE public.announcement_requests
ADD COLUMN IF NOT EXISTS requested_duration_hours integer;

UPDATE public.announcement_requests
SET requested_duration_hours = COALESCE(duration_hours, 1)
WHERE requested_duration_hours IS NULL;

ALTER TABLE public.announcement_requests
ALTER COLUMN requested_duration_hours SET DEFAULT 1,
ALTER COLUMN requested_duration_hours SET NOT NULL;

ALTER TABLE public.announcement_requests
DROP CONSTRAINT IF EXISTS announcement_requests_duration_hours_check,
ADD CONSTRAINT announcement_requests_duration_hours_range_check
  CHECK (duration_hours IS NULL OR duration_hours BETWEEN 1 AND 5),
ADD CONSTRAINT announcement_requests_requested_duration_hours_check
  CHECK (requested_duration_hours BETWEEN 1 AND 5);

GRANT INSERT (user_id, email, title, message, requested_duration_hours)
ON public.announcement_requests TO authenticated;

DROP POLICY IF EXISTS "PUP users submit announcement requests" ON public.announcement_requests;
CREATE POLICY "PUP users submit announcement requests"
ON public.announcement_requests FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND lower(email) = lower((SELECT auth.jwt() ->> 'email'))
  AND lower(email) LIKE '%@iskolarngbayan.pup.edu.ph'
  AND requested_duration_hours BETWEEN 1 AND 5
  AND status = 'pending_review'
  AND approved_title IS NULL
  AND approved_message IS NULL
  AND duration_hours IS NULL
  AND rate_per_hour IS NULL
  AND amount_due IS NULL
  AND payment_method IS NULL
  AND payment_proof_path IS NULL
);

CREATE OR REPLACE FUNCTION public.review_announcement_request(
  p_request_id uuid,
  p_approve boolean,
  p_approved_title text DEFAULT NULL,
  p_approved_message text DEFAULT NULL,
  p_duration_hours integer DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.announcement_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Choose whether to approve or reject the announcement';
  END IF;

  SELECT * INTO v_request
  FROM public.announcement_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'pending_review' THEN
    RAISE EXCEPTION 'This announcement is no longer awaiting content review';
  END IF;

  IF p_approve THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.announcement_payment_settings
      WHERE id = 'default'
        AND (length(trim(gcash_instructions)) > 0 OR length(trim(maribank_instructions)) > 0)
    ) THEN
      RAISE EXCEPTION 'Configure at least one payment method before approving announcement text';
    END IF;

    IF char_length(trim(coalesce(p_approved_title, ''))) NOT BETWEEN 1 AND 100
       OR char_length(trim(coalesce(p_approved_message, ''))) NOT BETWEEN 1 AND 500
       OR v_request.requested_duration_hours NOT BETWEEN 1 AND 5
       OR p_duration_hours IS DISTINCT FROM v_request.requested_duration_hours THEN
      RAISE EXCEPTION 'Provide approved text and use the requested duration between 1 and 5 hours';
    END IF;

    UPDATE public.announcement_requests
    SET approved_title = trim(p_approved_title),
        approved_message = trim(p_approved_message),
        duration_hours = v_request.requested_duration_hours,
        rate_per_hour = 10,
        amount_due = v_request.requested_duration_hours * 10,
        status = 'awaiting_payment',
        admin_note = NULL,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now()
    WHERE id = p_request_id;
  ELSE
    IF char_length(trim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Explain why the announcement text was rejected';
    END IF;

    UPDATE public.announcement_requests
    SET status = 'rejected',
        admin_note = nullif(trim(p_note), ''),
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now()
    WHERE id = p_request_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_announcement_payment(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.announcement_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;

  SELECT * INTO v_request
  FROM public.announcement_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_request.status <> 'payment_submitted'
     OR v_request.payment_proof_path IS NULL
     OR v_request.duration_hours NOT BETWEEN 1 AND 5
     OR v_request.amount_due <> v_request.duration_hours * 10
     OR NOT EXISTS (
       SELECT 1
       FROM storage.objects
       WHERE bucket_id = 'announcement-payment-evidence'
         AND name = v_request.payment_proof_path
     ) THEN
    RAISE EXCEPTION 'This request does not have valid payment proof awaiting verification';
  END IF;

  UPDATE public.announcement_requests
  SET status = 'published',
      payment_verified_by = auth.uid(),
      payment_verified_at = now(),
      published_at = now(),
      expires_at = now() + make_interval(hours => v_request.duration_hours),
      updated_at = now()
  WHERE id = p_request_id;
END;
$$;

COMMIT;
