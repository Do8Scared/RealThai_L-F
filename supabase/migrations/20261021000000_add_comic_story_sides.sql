BEGIN;

ALTER TABLE public.comic_chapters
  ADD COLUMN IF NOT EXISTS story_side text NOT NULL DEFAULT 'light';

ALTER TABLE public.comic_chapters
  DROP CONSTRAINT IF EXISTS comic_chapters_chapter_number_key,
  DROP CONSTRAINT IF EXISTS comic_chapters_story_side_check,
  DROP CONSTRAINT IF EXISTS comic_chapters_story_side_number_key;

ALTER TABLE public.comic_chapters
  ADD CONSTRAINT comic_chapters_story_side_check
    CHECK (story_side IN ('light', 'dark')),
  ADD CONSTRAINT comic_chapters_story_side_number_key
    UNIQUE (story_side, chapter_number);

INSERT INTO public.comic_chapters (story_side, chapter_number, title)
SELECT 'dark', chapter_number, format('Chapter %s', chapter_number)
FROM generate_series(1, 8) AS chapters(chapter_number)
ON CONFLICT (story_side, chapter_number) DO NOTHING;

DROP INDEX IF EXISTS public.comic_chapters_active_number_idx;
CREATE INDEX comic_chapters_active_story_side_number_idx
  ON public.comic_chapters (story_side, chapter_number)
  WHERE NOT is_archived;

CREATE OR REPLACE VIEW public.comic_chapter_slots
WITH (security_barrier = true)
AS
SELECT chapter_number, is_archived, story_side
FROM public.comic_chapters;

COMMIT;
