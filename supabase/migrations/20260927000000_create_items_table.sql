BEGIN;

CREATE TABLE IF NOT EXISTS public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  type text NOT NULL CHECK (type IN ('lost', 'found')),
  location text NOT NULL,
  "reporterName" text NOT NULL,
  contact text NOT NULL,
  department text NOT NULL DEFAULT '',
  "imageUrl" text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'claimed')),
  activity jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.items FROM anon, authenticated;
GRANT SELECT, INSERT ON public.items TO authenticated;
GRANT UPDATE (status) ON public.items TO authenticated;

DROP POLICY IF EXISTS "PUP users can read item listings" ON public.items;
CREATE POLICY "PUP users can read item listings"
ON public.items FOR SELECT TO authenticated
USING (
  lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
);

DROP POLICY IF EXISTS "PUP users can report items" ON public.items;
CREATE POLICY "PUP users can report items"
ON public.items FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
  AND status = 'open'
);

DROP POLICY IF EXISTS "Users can update their own item status" ON public.items;
CREATE POLICY "Users can update their own item status"
ON public.items FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
);

COMMIT;