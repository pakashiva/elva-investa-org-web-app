ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_status_check;
ALTER TABLE loans ADD CONSTRAINT loans_status_check
  CHECK (status IN ('draft', 'pending_approval', 'pending_customer_acceptance', 'approved', 'active', 'overdue', 'closed', 'rolled_over', 'written_off', 'rejected', 'cancelled'));

ALTER TABLE loans ADD COLUMN IF NOT EXISTS rollover_from_loan_id UUID;
ALTER TABLE loans ADD CONSTRAINT loans_rollover_parent_fk
  FOREIGN KEY (client_id, rollover_from_loan_id) REFERENCES loans (client_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS loans_rollover_parent_idx
  ON loans (client_id, rollover_from_loan_id, created_at DESC)
  WHERE rollover_from_loan_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS loans_one_open_rollover_per_parent
  ON loans (client_id, rollover_from_loan_id)
  WHERE rollover_from_loan_id IS NOT NULL
    AND status IN ('pending_approval', 'pending_customer_acceptance', 'approved', 'active', 'overdue');
