ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS submission_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS loans_custom_submission_key_unique
  ON loans (client_id, borrower_id, submission_key)
  WHERE request_type='custom' AND submission_key IS NOT NULL;