BEGIN;

CREATE TABLE IF NOT EXISTS public.user_feedback_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  topic text NOT NULL CHECK (topic IN ('website', 'announcement')),
  message text NOT NULL,
  evidence_image text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_feedback_reports_pending_created_at_idx
ON public.user_feedback_reports (status, created_at DESC);

ALTER TABLE public.user_feedback_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.user_feedback_reports TO authenticated;

DROP POLICY IF EXISTS "Users and admins read user feedback" ON public.user_feedback_reports;
CREATE POLICY "Users and admins read user feedback"
ON public.user_feedback_reports FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS "Users submit their own PUP feedback" ON public.user_feedback_reports;
CREATE POLICY "Users submit their own PUP feedback"
ON public.user_feedback_reports FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND lower(email) = lower((SELECT auth.jwt() ->> 'email'))
  AND lower(email) LIKE '%@iskolarngbayan.pup.edu.ph'
  AND topic IN ('website', 'announcement')
  AND status = 'pending'
);

DROP POLICY IF EXISTS "Admins update user feedback" ON public.user_feedback_reports;
CREATE POLICY "Admins update user feedback"
ON public.user_feedback_reports FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-feedback-evidence',
  'user-feedback-evidence',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users upload their own feedback evidence" ON storage.objects;
DROP POLICY IF EXISTS "PUP users upload their own feedback evidence" ON storage.objects;
CREATE POLICY "PUP users upload their own feedback evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'user-feedback-evidence'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
);

DROP POLICY IF EXISTS "Owners and admins read feedback evidence" ON storage.objects;
CREATE POLICY "Owners and admins read feedback evidence"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'user-feedback-evidence'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR public.is_admin()
  )
);

DROP POLICY IF EXISTS "Users delete their own feedback evidence" ON storage.objects;
CREATE POLICY "Users delete their own feedback evidence"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'user-feedback-evidence'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

COMMIT;