ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS enabled_modules TEXT[] NOT NULL DEFAULT ARRAY['invest']::TEXT[];

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'investor';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_enabled_modules_ck'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_enabled_modules_ck
      CHECK (
        cardinality(enabled_modules) > 0
        AND enabled_modules <@ ARRAY['invest', 'borrow']::TEXT[]
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_customer_type_ck'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_customer_type_ck
      CHECK (customer_type IN ('investor', 'borrower', 'both'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS loan_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  interest_model TEXT NOT NULL
    CHECK (interest_model IN ('simple', 'flat', 'reducing_balance')),
  interest_rate_percent NUMERIC(10, 6) NOT NULL CHECK (interest_rate_percent >= 0),
  interest_rate_period TEXT NOT NULL
    CHECK (interest_rate_period IN ('daily', 'weekly', 'monthly', 'annual')),
  interest_frequency TEXT NOT NULL
    CHECK (interest_frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'at_maturity')),
  repayment_model TEXT NOT NULL
    CHECK (repayment_model IN ('interest_only', 'principal_and_interest', 'bullet')),
  repayment_frequency TEXT NOT NULL
    CHECK (repayment_frequency IN ('weekly', 'monthly', 'quarterly', 'at_maturity')),
  payment_allocation TEXT NOT NULL
    CHECK (payment_allocation IN ('interest_first', 'principal_first')),
  grace_period_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_period_days >= 0),
  overdue_rule TEXT NOT NULL
    CHECK (overdue_rule IN ('status_only', 'percentage_charge', 'fixed_charge')),
  overdue_charge NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (overdue_charge >= 0),
  part_payments_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  advance_payment_treatment TEXT NOT NULL
    CHECK (advance_payment_treatment IN ('reduce_principal', 'cover_future_dues', 'credit_balance')),
  approval_workflow TEXT NOT NULL
    CHECK (approval_workflow IN ('manual', 'direct_activation')),
  disbursement_method TEXT NOT NULL DEFAULT 'manual_record'
    CHECK (disbursement_method = 'manual_record'),
  receipt_required BOOLEAN NOT NULL DEFAULT TRUE,
  write_off_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  closure_mode TEXT NOT NULL
    CHECK (closure_mode IN ('automatic', 'manual')),
  rounding_scale SMALLINT NOT NULL DEFAULT 2 CHECK (rounding_scale BETWEEN 0 AND 4),
  required_documents TEXT[] NOT NULL DEFAULT ARRAY['aadhaar', 'pan']::TEXT[],
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, id),
  CONSTRAINT loan_products_required_docs_ck
    CHECK (required_documents <@ ARRAY['aadhaar', 'pan', 'address_proof', 'income_proof', 'bank_statement']::TEXT[])
);

CREATE INDEX IF NOT EXISTS loan_products_client_status_idx
  ON loan_products (client_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS loan_products_client_name_idx
  ON loan_products (client_id, lower(name));

CREATE SEQUENCE IF NOT EXISTS loan_number_seq START WITH 1;

CREATE TABLE IF NOT EXISTS borrowers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked', 'closed')),
  assigned_staff_id UUID REFERENCES users (id) ON DELETE SET NULL,
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, customer_id),
  UNIQUE (client_id, id),
  FOREIGN KEY (customer_id, client_id)
    REFERENCES customers (id, client_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS borrowers_client_status_idx
  ON borrowers (client_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  borrower_id UUID NOT NULL,
  product_id UUID NOT NULL,
  loan_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'active', 'overdue', 'closed', 'written_off', 'rejected')),
  principal_amount NUMERIC(15, 2) NOT NULL CHECK (principal_amount > 0),
  interest_rate_percent NUMERIC(10, 6) NOT NULL CHECK (interest_rate_percent >= 0),
  terms_snapshot JSONB NOT NULL,
  start_date DATE,
  maturity_date DATE,
  disbursed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users (id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, loan_number),
  UNIQUE (client_id, id),
  FOREIGN KEY (client_id, borrower_id)
    REFERENCES borrowers (client_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id, product_id)
    REFERENCES loan_products (client_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS loans_client_status_idx
  ON loans (client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS loans_borrower_idx
  ON loans (client_id, borrower_id, created_at DESC);

CREATE TABLE IF NOT EXISTS loan_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  loan_id UUID NOT NULL,
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  due_date DATE NOT NULL,
  principal_due NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (principal_due >= 0),
  interest_due NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (interest_due >= 0),
  overdue_charge NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (overdue_charge >= 0),
  amount_paid NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'partial', 'paid', 'overdue', 'waived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id, installment_number),
  UNIQUE (client_id, id),
  FOREIGN KEY (client_id, loan_id)
    REFERENCES loans (client_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS loan_schedules_client_due_idx
  ON loan_schedules (client_id, due_date, status);

CREATE TABLE IF NOT EXISTS loan_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  loan_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  received_on DATE NOT NULL,
  amount_received NUMERIC(15, 2) NOT NULL CHECK (amount_received > 0),
  principal_component NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (principal_component >= 0),
  interest_component NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (interest_component >= 0),
  overdue_component NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (overdue_component >= 0),
  unapplied_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (unapplied_amount >= 0),
  reference_number TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reverses_payment_id UUID,
  recorded_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, id),
  FOREIGN KEY (client_id, loan_id)
    REFERENCES loans (client_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id, client_id)
    REFERENCES customers (id, client_id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id, reverses_payment_id)
    REFERENCES loan_payments (client_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS loan_payments_client_date_idx
  ON loan_payments (client_id, received_on DESC);
CREATE INDEX IF NOT EXISTS loan_payments_loan_idx
  ON loan_payments (client_id, loan_id, received_on DESC);

CREATE TABLE IF NOT EXISTS loan_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  loan_id UUID NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('disbursement', 'interest_accrued', 'payment', 'adjustment', 'write_off', 'closure', 'reversal')),
  principal_debit NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (principal_debit >= 0),
  principal_credit NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (principal_credit >= 0),
  interest_debit NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (interest_debit >= 0),
  interest_credit NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (interest_credit >= 0),
  overdue_debit NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (overdue_debit >= 0),
  overdue_credit NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (overdue_credit >= 0),
  reference_type TEXT,
  reference_id UUID,
  event_date DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (client_id, loan_id)
    REFERENCES loans (client_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS loan_ledger_client_date_idx
  ON loan_ledger (client_id, event_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS loan_ledger_loan_idx
  ON loan_ledger (client_id, loan_id, event_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS loan_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  borrower_id UUID NOT NULL,
  loan_id UUID,
  document_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  uploaded_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (client_id, borrower_id)
    REFERENCES borrowers (client_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id, loan_id)
    REFERENCES loans (client_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS loan_documents_borrower_idx
  ON loan_documents (client_id, borrower_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collection_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  borrower_id UUID NOT NULL,
  loan_id UUID NOT NULL,
  schedule_id UUID,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  assigned_staff_id UUID REFERENCES users (id) ON DELETE SET NULL,
  completed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (client_id, borrower_id)
    REFERENCES borrowers (client_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id, loan_id)
    REFERENCES loans (client_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id, schedule_id)
    REFERENCES loan_schedules (client_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS collection_tasks_client_due_idx
  ON collection_tasks (client_id, due_date, status);

CREATE TABLE IF NOT EXISTS loan_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS loan_audit_logs_client_entity_idx
  ON loan_audit_logs (client_id, entity_type, entity_id, created_at DESC);
