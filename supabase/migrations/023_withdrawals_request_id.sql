-- Additive: request_id on withdrawals (nullable).
-- Existing rows stay NULL. Do not generate IDs here.
-- Unique only when a value is assigned (partial unique index).

ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_request_id_unique
  ON public.withdrawals (request_id)
  WHERE request_id IS NOT NULL;

COMMENT ON COLUMN public.withdrawals.request_id IS
  'Admin-facing withdrawal request code. Existing rows are NULL until assigned.';
