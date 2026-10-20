BEGIN;

CREATE TABLE IF NOT EXISTS public.handoff_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  initiator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  initiator_confirmed_at timestamptz NOT NULL DEFAULT now(),
  partner_confirmed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT handoff_transactions_distinct_participants CHECK (initiator_id <> partner_id),
  CONSTRAINT handoff_transactions_completion_state CHECK (
    (status = 'pending' AND completed_at IS NULL)
    OR (status = 'completed' AND partner_confirmed_at IS NOT NULL AND completed_at IS NOT NULL)
    OR status = 'cancelled'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS handoff_transactions_one_active_per_item
ON public.handoff_transactions (item_id)
WHERE status IN ('pending', 'completed');

CREATE INDEX IF NOT EXISTS handoff_transactions_initiator_created
ON public.handoff_transactions (initiator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS handoff_transactions_partner_created
ON public.handoff_transactions (partner_id, created_at DESC);

ALTER TABLE public.handoff_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.handoff_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.handoff_transactions TO authenticated;

DROP POLICY IF EXISTS "Participants can read their handoff transactions"
ON public.handoff_transactions;
CREATE POLICY "Participants can read their handoff transactions"
ON public.handoff_transactions FOR SELECT TO authenticated
USING (
  lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
  AND (
    initiator_id = (SELECT auth.uid())
    OR partner_id = (SELECT auth.uid())
  )
);

CREATE OR REPLACE FUNCTION public.start_handoff_confirmation(
  p_item_id uuid,
  p_partner_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requester_id uuid := (SELECT auth.uid());
  requester_email text := lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''));
  normalized_partner_email text := lower(btrim(COALESCE(p_partner_email, '')));
  partner_id uuid;
  item_owner_id uuid;
  item_status text;
  transaction_id uuid;
BEGIN
  IF requester_id IS NULL
    OR requester_email NOT LIKE '%@iskolarngbayan.pup.edu.ph'
    OR length(requester_email) - length(replace(requester_email, '@', '')) <> 1 THEN
    RAISE EXCEPTION 'A PUP account is required to start a handoff';
  END IF;

  IF normalized_partner_email = ''
    OR split_part(normalized_partner_email, '@', 1) = ''
    OR split_part(normalized_partner_email, '@', 2) <> 'iskolarngbayan.pup.edu.ph'
    OR length(normalized_partner_email) - length(replace(normalized_partner_email, '@', '')) <> 1 THEN
    RAISE EXCEPTION 'Enter a valid PUP institutional email for the other participant';
  END IF;

  IF normalized_partner_email = requester_email THEN
    RAISE EXCEPTION 'The other participant must use a different account';
  END IF;

  SELECT id
  INTO partner_id
  FROM auth.users
  WHERE lower(email) = normalized_partner_email
    AND email_confirmed_at IS NOT NULL;

  IF partner_id IS NULL THEN
    RAISE EXCEPTION 'No verified PUP account was found for that email';
  END IF;

  SELECT user_id, status
  INTO item_owner_id, item_status
  FROM public.items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The report could not be found';
  END IF;

  IF item_owner_id IS DISTINCT FROM requester_id THEN
    RAISE EXCEPTION 'Only the report author can start its handoff';
  END IF;

  IF item_status <> 'open' THEN
    RAISE EXCEPTION 'Only an open report can start a handoff';
  END IF;

  INSERT INTO public.handoff_transactions (item_id, initiator_id, partner_id)
  VALUES (p_item_id, requester_id, partner_id)
  RETURNING id INTO transaction_id;

  UPDATE public.items
  SET status = 'claimed'
  WHERE id = p_item_id;

  RETURN transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_handoff_confirmation(p_transaction_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requester_id uuid := (SELECT auth.uid());
  requester_email text := lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''));
  transaction_row public.handoff_transactions%ROWTYPE;
  new_status text;
BEGIN
  IF requester_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to confirm this handoff';
  END IF;

  IF requester_email NOT LIKE '%@iskolarngbayan.pup.edu.ph'
    OR length(requester_email) - length(replace(requester_email, '@', '')) <> 1 THEN
    RAISE EXCEPTION 'A PUP account is required to confirm this handoff';
  END IF;

  SELECT *
  INTO transaction_row
  FROM public.handoff_transactions
  WHERE id = p_transaction_id
    AND (
      initiator_id = requester_id
      OR partner_id = requester_id
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The handoff could not be found or you are not a participant';
  END IF;

  IF transaction_row.status = 'completed' THEN
    RETURN transaction_row.status;
  END IF;

  IF transaction_row.status <> 'pending' THEN
    RAISE EXCEPTION 'This handoff is no longer pending';
  END IF;

  IF requester_id = transaction_row.partner_id THEN
    UPDATE public.handoff_transactions
    SET partner_confirmed_at = COALESCE(partner_confirmed_at, now()),
        status = CASE
          WHEN initiator_confirmed_at IS NOT NULL THEN 'completed'
          ELSE 'pending'
        END,
        completed_at = CASE
          WHEN initiator_confirmed_at IS NOT NULL THEN now()
          ELSE NULL
        END
    WHERE id = p_transaction_id
    RETURNING status INTO new_status;
  ELSE
    new_status := transaction_row.status;
  END IF;

  IF new_status = 'completed' THEN
    UPDATE public.items
    SET status = 'resolved'
    WHERE id = transaction_row.item_id
      AND status = 'claimed';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The report status changed before the handoff completed';
    END IF;
  END IF;

  RETURN new_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_handoff_confirmation(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requester_id uuid := (SELECT auth.uid());
  requester_email text := lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''));
  transaction_row public.handoff_transactions%ROWTYPE;
BEGIN
  IF requester_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to cancel this handoff';
  END IF;

  IF requester_email NOT LIKE '%@iskolarngbayan.pup.edu.ph'
    OR length(requester_email) - length(replace(requester_email, '@', '')) <> 1 THEN
    RAISE EXCEPTION 'A PUP account is required to cancel this handoff';
  END IF;

  SELECT *
  INTO transaction_row
  FROM public.handoff_transactions
  WHERE id = p_transaction_id
    AND initiator_id = requester_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The handoff could not be found or you are not its initiator';
  END IF;

  IF transaction_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending handoff can be cancelled';
  END IF;

  UPDATE public.handoff_transactions
  SET status = 'cancelled'
  WHERE id = p_transaction_id;

  UPDATE public.items
  SET status = 'open'
  WHERE id = transaction_row.item_id
    AND status = 'claimed';
END;
$$;

REVOKE ALL ON FUNCTION public.start_handoff_confirmation(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_handoff_confirmation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_handoff_confirmation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_handoff_confirmation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_handoff_confirmation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_handoff_confirmation(uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can update their own item status" ON public.items;
REVOKE UPDATE (status) ON public.items FROM authenticated;

COMMIT;
