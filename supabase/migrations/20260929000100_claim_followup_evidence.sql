BEGIN;

ALTER TABLE public.claim_followup_requests
ADD COLUMN IF NOT EXISTS evidence_image text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'claim-evidence',
  'claim-evidence',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users upload their own claim evidence" ON storage.objects;
CREATE POLICY "Users upload their own claim evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'claim-evidence'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

DROP POLICY IF EXISTS "Owners and admins read claim evidence" ON storage.objects;
CREATE POLICY "Owners and admins read claim evidence"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'claim-evidence'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR public.is_admin()
  )
);

DROP POLICY IF EXISTS "Users delete their own claim evidence" ON storage.objects;
CREATE POLICY "Users delete their own claim evidence"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'claim-evidence'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

COMMIT;