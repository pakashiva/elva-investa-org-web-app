-- Tenant-scoped agreements, renewals, and cheque field presets.
-- Every client uses the same Ballari (30-day) / Raichur (60-day) templates.

CREATE TABLE IF NOT EXISTS agreement_renewal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  investment_id UUID NOT NULL REFERENCES investments (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  agreement_id TEXT NOT NULL,
  current_amount NUMERIC(15, 2) NOT NULL CHECK (current_amount > 0),
  increment_amount NUMERIC(15, 2) NULL,
  mode TEXT NOT NULL CHECK (mode IN ('same_amount', 'increase')),
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agreement_renewals_pending_unique
  ON agreement_renewal_requests (investment_id)
  WHERE status = 'Pending';

CREATE INDEX IF NOT EXISTS agreement_renewals_client_status_idx
  ON agreement_renewal_requests (client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS agreement_renewals_customer_idx
  ON agreement_renewal_requests (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agreement_cheque_field_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  field_kind TEXT NOT NULL
    CHECK (field_kind IN ('cheque_no', 'bank_name', 'bank_address')),
  field_value TEXT NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agreement_cheque_field_presets_unique
  ON agreement_cheque_field_presets (client_id, field_kind, lower(field_value));

CREATE INDEX IF NOT EXISTS agreement_cheque_field_presets_client_idx
  ON agreement_cheque_field_presets (client_id, field_kind, last_used_at DESC);

CREATE TABLE IF NOT EXISTS investment_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  investment_id UUID NOT NULL REFERENCES investments (id) ON DELETE CASCADE,
  renewal_id UUID REFERENCES agreement_renewal_requests (id) ON DELETE CASCADE,
  branch TEXT NOT NULL CHECK (branch IN ('ballari', 'raichur')),
  agreement_date DATE NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  fund_amount NUMERIC(15, 2) NOT NULL,
  cheque_no TEXT NOT NULL,
  cheque_bank_name TEXT NOT NULL,
  cheque_bank_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS investment_agreements_original_unique
  ON investment_agreements (investment_id)
  WHERE renewal_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS investment_agreements_renewal_unique
  ON investment_agreements (renewal_id)
  WHERE renewal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS investment_agreements_client_idx
  ON investment_agreements (client_id, investment_id);

ALTER TABLE customer_notifications
  DROP CONSTRAINT IF EXISTS customer_notifications_kind_check;

ALTER TABLE customer_notifications
  ADD CONSTRAINT customer_notifications_kind_check
  CHECK (kind IN ('investment', 'withdrawal', 'renewal'));

CREATE OR REPLACE FUNCTION public.trg_notify_renewal_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status = 'Pending'
     AND NEW.status IN ('Approved', 'Rejected') THEN
    INSERT INTO customer_notifications (
      client_id,
      customer_id,
      kind,
      title,
      body,
      reference_id,
      decision
    ) VALUES (
      NEW.client_id,
      NEW.customer_id,
      'renewal',
      CASE
        WHEN NEW.status = 'Approved' THEN 'Agreement renewal approved'
        ELSE 'Agreement renewal rejected'
      END,
      CASE
        WHEN NEW.status = 'Approved' THEN
          'Your agreement renewal for ₹' ||
          to_char(
            CASE
              WHEN NEW.mode = 'increase'
                THEN COALESCE(NEW.current_amount, 0) + COALESCE(NEW.increment_amount, 0)
              ELSE NEW.current_amount
            END,
            'FM9999999990.00'
          ) || ' has been approved. A new 365-day term starts today.'
        ELSE
          'Your agreement renewal request has been rejected.'
      END,
      NEW.id,
      CASE WHEN NEW.status = 'Approved' THEN 'approved' ELSE 'rejected' END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_renewal_decision ON agreement_renewal_requests;
CREATE TRIGGER trg_notify_renewal_decision
  AFTER UPDATE OF status ON agreement_renewal_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_renewal_decision();
