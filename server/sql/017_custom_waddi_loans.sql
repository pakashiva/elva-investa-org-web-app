ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS custom_duration_days INTEGER,
  ADD COLUMN IF NOT EXISTS repayment_preference TEXT,
  ADD COLUMN IF NOT EXISTS submission_key TEXT,
  ADD COLUMN IF NOT EXISTS counter_offer_count SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counter_offer JSONB;

ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_request_type_check;
ALTER TABLE loans ADD CONSTRAINT loans_request_type_check
  CHECK (request_type IN ('standard', 'custom'));
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_repayment_preference_check;
ALTER TABLE loans ADD CONSTRAINT loans_repayment_preference_check
  CHECK (repayment_preference IS NULL OR repayment_preference IN ('maturity', 'flexible'));
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_counter_offer_count_check;
ALTER TABLE loans ADD CONSTRAINT loans_counter_offer_count_check
  CHECK (counter_offer_count BETWEEN 0 AND 1);

ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_status_check;
ALTER TABLE loans ADD CONSTRAINT loans_status_check
  CHECK (status IN ('draft', 'pending_approval', 'pending_customer_acceptance', 'approved', 'active', 'overdue', 'closed', 'written_off', 'rejected', 'cancelled'));

ALTER TABLE customer_notifications DROP CONSTRAINT IF EXISTS customer_notifications_decision_check;
ALTER TABLE customer_notifications ADD CONSTRAINT customer_notifications_decision_check
  CHECK (decision IN ('approved', 'rejected', 'recorded', 'due', 'overdue', 'offer', 'cancelled'));

CREATE INDEX IF NOT EXISTS loans_client_request_status_idx
  ON loans (client_id, request_type, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS loans_custom_submission_key_unique
  ON loans (client_id, borrower_id, submission_key)
  WHERE request_type='custom' AND submission_key IS NOT NULL;
