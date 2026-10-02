BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images',
  'item-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "PUP users upload item images" ON storage.objects;
CREATE POLICY "PUP users upload item images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'item-images'
  AND lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
);

COMMIT;