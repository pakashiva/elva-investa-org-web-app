ALTER TABLE loan_documents
  ADD COLUMN IF NOT EXISTS document_data BYTEA,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER;

ALTER TABLE customer_notifications
  DROP CONSTRAINT IF EXISTS customer_notifications_kind_check;

ALTER TABLE customer_notifications
  ADD CONSTRAINT customer_notifications_kind_check
  CHECK (kind IN ('investment', 'withdrawal', 'renewal', 'loan'));

ALTER TABLE customer_notifications
  DROP CONSTRAINT IF EXISTS customer_notifications_decision_check;

ALTER TABLE customer_notifications
  ADD CONSTRAINT customer_notifications_decision_check
  CHECK (decision IN ('approved', 'rejected', 'recorded', 'due', 'overdue'));

CREATE UNIQUE INDEX IF NOT EXISTS customer_notifications_loan_event_unique
  ON customer_notifications (customer_id, reference_id, kind, decision)
  WHERE kind='loan' AND reference_id IS NOT NULL;
