BEGIN;

-- 1. Grant sequence permissions on items_post_number_seq to authenticated users
--    Required so authenticated PUP users can insert new item reports without sequence permission errors.
GRANT USAGE, SELECT ON SEQUENCE public.items_post_number_seq TO authenticated;

-- 2. Allow public and authenticated read access to uploaded images in the 'item-images' storage bucket
DROP POLICY IF EXISTS "Public read item images" ON storage.objects;
CREATE POLICY "Public read item images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'item-images');

COMMIT;
