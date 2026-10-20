BEGIN;

CREATE TABLE IF NOT EXISTS public.announcement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 100),
  message text NOT NULL CHECK (char_length(trim(message)) BETWEEN 1 AND 500),
  approved_title text,
  approved_message text,
  duration_hours integer CHECK (duration_hours BETWEEN 1 AND 3),
  rate_per_hour numeric(10, 2),
  amount_due numeric(10, 2),
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'awaiting_payment', 'payment_submitted', 'published', 'rejected')),
  payment_method text CHECK (payment_method IN ('gcash', 'maribank')),
  payment_proof_path text,
  admin_note text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  payment_verified_by uuid REFERENCES auth.users(id),
  payment_verified_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status NOT IN ('awaiting_payment', 'payment_submitted', 'published')
    OR (
      approved_title IS NOT NULL
      AND approved_message IS NOT NULL
      AND char_length(trim(approved_title)) BETWEEN 1 AND 100
      AND char_length(trim(approved_message)) BETWEEN 1 AND 500
      AND duration_hours IS NOT NULL
      AND rate_per_hour = 10
      AND amount_due = duration_hours * rate_per_hour
    )
  ),
  CHECK (admin_note IS NULL OR char_length(admin_note) <= 500),
  CHECK (
    status != 'published'
    OR (
      payment_method IS NOT NULL
      AND payment_proof_path IS NOT NULL
      AND payment_verified_by IS NOT NULL
      AND payment_verified_at IS NOT NULL
      AND published_at IS NOT NULL
      AND expires_at > published_at
    )
  ),
  CHECK (status != 'payment_submitted' OR (payment_method IS NOT NULL AND payment_proof_path IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS announcement_requests_status_created_at_idx
ON public.announcement_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS announcement_requests_active_idx
ON public.announcement_requests (expires_at DESC)
WHERE status = 'published';

ALTER TABLE public.announcement_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.announcement_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.announcement_requests TO authenticated;
GRANT INSERT (user_id, email, title, message) ON public.announcement_requests TO authenticated;

DROP POLICY IF EXISTS "Users read own and active announcements" ON public.announcement_requests;
DROP POLICY IF EXISTS "Users and admins read announcement requests" ON public.announcement_requests;
CREATE POLICY "Users and admins read announcement requests"
ON public.announcement_requests FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.is_admin()
);

DROP POLICY IF EXISTS "PUP users submit announcement requests" ON public.announcement_requests;
CREATE POLICY "PUP users submit announcement requests"
ON public.announcement_requests FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND lower(email) = lower((SELECT auth.jwt() ->> 'email'))
  AND lower(email) LIKE '%@iskolarngbayan.pup.edu.ph'
  AND status = 'pending_review'
  AND approved_title IS NULL
  AND approved_message IS NULL
  AND duration_hours IS NULL
  AND rate_per_hour IS NULL
  AND amount_due IS NULL
  AND payment_method IS NULL
  AND payment_proof_path IS NULL
);

CREATE OR REPLACE VIEW public.active_announcements
WITH (security_barrier = true)
AS
SELECT approved_title, approved_message, published_at, expires_at
FROM public.announcement_requests
WHERE status = 'published'
  AND expires_at > now();

REVOKE ALL ON public.active_announcements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.active_announcements TO authenticated;

CREATE TABLE IF NOT EXISTS public.announcement_payment_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  gcash_instructions text NOT NULL DEFAULT '',
  maribank_instructions text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  CHECK (char_length(gcash_instructions) <= 1000),
  CHECK (char_length(maribank_instructions) <= 1000)
);

INSERT INTO public.announcement_payment_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.announcement_payment_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.announcement_payment_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.announcement_payment_settings TO authenticated;
GRANT UPDATE (gcash_instructions, maribank_instructions, updated_at, updated_by) ON public.announcement_payment_settings TO authenticated;

DROP POLICY IF EXISTS "Authenticated users read announcement payment details" ON public.announcement_payment_settings;
CREATE POLICY "Authenticated users read announcement payment details"
ON public.announcement_payment_settings FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.announcement_requests
    WHERE user_id = (SELECT auth.uid())
      AND status = 'awaiting_payment'
  )
);

DROP POLICY IF EXISTS "Admins update announcement payment details" ON public.announcement_payment_settings;
CREATE POLICY "Admins update announcement payment details"
ON public.announcement_payment_settings FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

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
       OR p_duration_hours IS NULL
       OR p_duration_hours NOT BETWEEN 1 AND 3 THEN
      RAISE EXCEPTION 'Provide approved text and a duration between 1 and 3 hours';
    END IF;

    UPDATE public.announcement_requests
    SET approved_title = trim(p_approved_title),
        approved_message = trim(p_approved_message),
        duration_hours = p_duration_hours,
        rate_per_hour = 10,
        amount_due = p_duration_hours * 10,
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

CREATE OR REPLACE FUNCTION public.submit_announcement_payment(
  p_request_id uuid,
  p_payment_method text,
  p_proof_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before submitting payment proof';
  END IF;
  IF p_payment_method NOT IN ('gcash', 'maribank') THEN
    RAISE EXCEPTION 'Choose GCash or MariBank';
  END IF;
  IF p_proof_path IS NULL OR p_proof_path NOT LIKE auth.uid()::text || '/%' THEN
    RAISE EXCEPTION 'Payment proof must belong to the signed-in user';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'announcement-payment-evidence'
      AND name = p_proof_path
  ) THEN
    RAISE EXCEPTION 'Upload a valid payment receipt before submitting';
  END IF;

  UPDATE public.announcement_requests
  SET payment_method = p_payment_method,
      payment_proof_path = p_proof_path,
      status = 'payment_submitted',
      admin_note = NULL,
      updated_at = now()
  WHERE id = p_request_id
    AND user_id = auth.uid()
    AND status = 'awaiting_payment';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This announcement is not awaiting payment';
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
     OR v_request.duration_hours NOT BETWEEN 1 AND 3
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

CREATE OR REPLACE FUNCTION public.reject_announcement_payment(
  p_request_id uuid,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;
  IF char_length(trim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Explain why the payment proof needs to be resubmitted';
  END IF;

  UPDATE public.announcement_requests
  SET status = 'awaiting_payment',
      payment_method = NULL,
      payment_proof_path = NULL,
      admin_note = trim(p_note),
      updated_at = now()
  WHERE id = p_request_id
    AND status = 'payment_submitted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This request is no longer awaiting payment verification';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_announcement_request(uuid, boolean, text, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_announcement_payment(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_announcement_payment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_announcement_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_announcement_request(uuid, boolean, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_announcement_payment(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_announcement_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_announcement_payment(uuid, text) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcement-payment-evidence',
  'announcement-payment-evidence',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users upload their own announcement payment evidence" ON storage.objects;
CREATE POLICY "Users upload their own announcement payment evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'announcement-payment-evidence'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
);

DROP POLICY IF EXISTS "Owners and admins read announcement payment evidence" ON storage.objects;
CREATE POLICY "Owners and admins read announcement payment evidence"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'announcement-payment-evidence'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR public.is_admin()
  )
);

DROP POLICY IF EXISTS "Owners and admins delete announcement payment evidence" ON storage.objects;
CREATE POLICY "Owners and admins delete announcement payment evidence"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'announcement-payment-evidence'
  AND (
    public.is_admin()
    OR (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      AND NOT EXISTS (
        SELECT 1
        FROM public.announcement_requests
        WHERE payment_proof_path = name
          AND status IN ('payment_submitted', 'published')
      )
    )
  )
);

COMMIT;
