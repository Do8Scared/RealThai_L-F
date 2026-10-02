BEGIN;

LOCK TABLE public.items IN ACCESS EXCLUSIVE MODE;

CREATE SEQUENCE IF NOT EXISTS public.items_post_number_seq;

ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS post_number bigint;

UPDATE public.items
SET post_number = nextval('public.items_post_number_seq')
WHERE post_number IS NULL;

ALTER TABLE public.items
ALTER COLUMN post_number SET DEFAULT nextval('public.items_post_number_seq');

ALTER TABLE public.items
ALTER COLUMN post_number SET NOT NULL;

ALTER SEQUENCE public.items_post_number_seq
OWNED BY public.items.post_number;

SELECT setval(
  'public.items_post_number_seq',
  COALESCE(MAX(post_number), 0) + 1,
  false
)
FROM public.items;

CREATE UNIQUE INDEX IF NOT EXISTS items_post_number_key
ON public.items (post_number);

COMMIT;