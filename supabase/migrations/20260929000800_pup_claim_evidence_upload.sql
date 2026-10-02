BEGIN;

DROP POLICY IF EXISTS "Users upload their own claim evidence"
ON storage.objects;

CREATE POLICY "PUP users upload their own claim evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'claim-evidence'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
);

COMMIT;