BEGIN;

DROP POLICY IF EXISTS "Users can submit own claim follow-ups"
ON public.claim_followup_requests;
CREATE POLICY "PUP users can submit own claim follow-ups"
ON public.claim_followup_requests FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND lower(claimant_email) = lower((SELECT auth.jwt() ->> 'email'))
  AND lower(claimant_email) LIKE '%@iskolarngbayan.pup.edu.ph'
  AND status = 'pending'
);

DROP POLICY IF EXISTS "Users can submit own owner match requests"
ON public.owner_match_requests;
CREATE POLICY "PUP users can submit own owner match requests"
ON public.owner_match_requests FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND lower((SELECT auth.jwt() ->> 'email')) LIKE '%@iskolarngbayan.pup.edu.ph'
  AND status = 'pending'
);

COMMIT;