BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_user_activity (
  user_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL,
  last_sign_in_at timestamptz,
  deleted_at timestamptz
);

ALTER TABLE public.admin_user_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_user_activity FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_admin_user_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.admin_user_activity
    SET deleted_at = COALESCE(deleted_at, now())
    WHERE user_id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.admin_user_activity (user_id, created_at, last_sign_in_at)
  VALUES (NEW.id, NEW.created_at, NEW.last_sign_in_at)
  ON CONFLICT (user_id) DO UPDATE
  SET created_at = EXCLUDED.created_at,
      last_sign_in_at = EXCLUDED.last_sign_in_at;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_admin_user_activity() FROM PUBLIC;

INSERT INTO public.admin_user_activity (user_id, created_at, last_sign_in_at)
SELECT id, created_at, last_sign_in_at
FROM auth.users
ON CONFLICT (user_id) DO UPDATE
SET created_at = EXCLUDED.created_at,
    last_sign_in_at = EXCLUDED.last_sign_in_at;

DROP TRIGGER IF EXISTS capture_admin_user_activity_after_auth_change ON auth.users;
CREATE TRIGGER capture_admin_user_activity_after_auth_change
AFTER INSERT OR UPDATE OR DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_user_activity();

CREATE OR REPLACE FUNCTION public.admin_user_metrics()
RETURNS TABLE (
  total_users bigint,
  active_users_30d bigint,
  new_users_30d bigint,
  inactive_users_30d bigint,
  deleted_users bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    count(*) FILTER (WHERE deleted_at IS NULL),
    count(*) FILTER (WHERE deleted_at IS NULL AND last_sign_in_at >= now() - interval '30 days'),
    count(*) FILTER (WHERE deleted_at IS NULL AND created_at >= now() - interval '30 days'),
    count(*) FILTER (WHERE deleted_at IS NULL AND (last_sign_in_at IS NULL OR last_sign_in_at < now() - interval '30 days')),
    count(*) FILTER (WHERE deleted_at IS NOT NULL)
  FROM public.admin_user_activity
  WHERE public.is_admin();
$$;

REVOKE ALL ON FUNCTION public.admin_user_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_metrics() TO authenticated;

COMMIT;