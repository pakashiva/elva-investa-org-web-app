ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_request_type_check;
ALTER TABLE loans ADD CONSTRAINT loans_request_type_check
  CHECK (request_type IN ('standard', 'custom', 'regular', 'daily'));

CREATE UNIQUE INDEX IF NOT EXISTS loans_daily_submission_key_unique
  ON loans (client_id, borrower_id, submission_key)
  WHERE request_type='daily' AND submission_key IS NOT NULL;
