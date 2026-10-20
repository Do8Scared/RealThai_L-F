BEGIN;

GRANT DELETE ON public.items TO authenticated;

DROP POLICY IF EXISTS "Admins delete item posts" ON public.items;
CREATE POLICY "Admins delete item posts"
ON public.items FOR DELETE TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "Admins delete item images" ON storage.objects;
CREATE POLICY "Admins delete item images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'item-images'
  AND public.is_admin()
);

COMMIT;
