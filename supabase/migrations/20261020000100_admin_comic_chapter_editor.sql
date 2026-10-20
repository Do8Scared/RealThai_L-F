BEGIN;

CREATE TABLE IF NOT EXISTS public.comic_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_number integer NOT NULL UNIQUE CHECK (chapter_number > 0),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  cover_path text,
  page_paths text[] NOT NULL DEFAULT '{}',
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comic_chapters_active_number_idx
ON public.comic_chapters (chapter_number)
WHERE NOT is_archived;

INSERT INTO public.comic_chapters (chapter_number, title)
SELECT chapter_number, format('Chapter %s', chapter_number)
FROM generate_series(1, 8) AS chapters(chapter_number)
ON CONFLICT (chapter_number) DO NOTHING;

ALTER TABLE public.comic_chapters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comic_chapters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comic_chapters TO authenticated;
GRANT INSERT (id, chapter_number, title, description, cover_path, page_paths, created_by, updated_by)
ON public.comic_chapters TO authenticated;
GRANT UPDATE (title, description, cover_path, page_paths, is_archived, updated_by, updated_at)
ON public.comic_chapters TO authenticated;

DROP POLICY IF EXISTS "Users read active chapters and admins read all" ON public.comic_chapters;
CREATE POLICY "Users read active chapters and admins read all"
ON public.comic_chapters FOR SELECT TO authenticated
USING (NOT is_archived OR public.is_admin());

CREATE OR REPLACE VIEW public.comic_chapter_slots
WITH (security_barrier = true)
AS
SELECT chapter_number, is_archived
FROM public.comic_chapters;

REVOKE ALL ON public.comic_chapter_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comic_chapter_slots TO authenticated;

DROP POLICY IF EXISTS "Admins create comic chapters" ON public.comic_chapters;
CREATE POLICY "Admins create comic chapters"
ON public.comic_chapters FOR INSERT TO authenticated
WITH CHECK (
  public.is_admin()
  AND created_by = (SELECT auth.uid())
  AND updated_by = (SELECT auth.uid())
  AND NOT is_archived
);

DROP POLICY IF EXISTS "Admins update comic chapters" ON public.comic_chapters;
CREATE POLICY "Admins update comic chapters"
ON public.comic_chapters FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

COMMIT;
