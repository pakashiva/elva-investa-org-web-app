CREATE TABLE IF NOT EXISTS customer_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('investment', 'withdrawal')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_notifications_customer_created_idx
  ON customer_notifications (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_notifications_customer_unread_idx
  ON customer_notifications (customer_id)
  WHERE is_read = FALSE;

CREATE OR REPLACE FUNCTION public.trg_notify_investment_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status IN ('Pending', 'Under Review')
     AND NEW.status IN ('Active', 'Rejected') THEN
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
      'investment',
      CASE
        WHEN NEW.status = 'Active' THEN 'Investment approved'
        ELSE 'Investment rejected'
      END,
      CASE
        WHEN NEW.status = 'Active' THEN
          'Your fund request "' || COALESCE(NEW.name, NEW.code) ||
          '" for ₹' || to_char(NEW.fund_amount, 'FM9999999990.00') ||
          ' has been approved.'
        ELSE
          'Your fund request "' || COALESCE(NEW.name, NEW.code) ||
          '" for ₹' || to_char(NEW.fund_amount, 'FM9999999990.00') ||
          ' has been rejected.'
      END,
      NEW.id,
      CASE WHEN NEW.status = 'Active' THEN 'approved' ELSE 'rejected' END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_investment_decision ON investments;
CREATE TRIGGER trg_notify_investment_decision
  AFTER UPDATE OF status ON investments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_investment_decision();

CREATE OR REPLACE FUNCTION public.trg_notify_withdrawal_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status IN ('Processing', 'On Hold')
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
      'withdrawal',
      CASE
        WHEN NEW.status = 'Approved' THEN 'Withdrawal approved'
        ELSE 'Withdrawal rejected'
      END,
      CASE
        WHEN NEW.status = 'Approved' THEN
          'Your withdrawal request for ₹' ||
          to_char(NEW.withdrawal_amount, 'FM9999999990.00') ||
          ' has been approved.'
        ELSE
          'Your withdrawal request for ₹' ||
          to_char(NEW.withdrawal_amount, 'FM9999999990.00') ||
          ' has been rejected.'
      END,
      NEW.id,
      CASE WHEN NEW.status = 'Approved' THEN 'approved' ELSE 'rejected' END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_withdrawal_decision ON withdrawals;
CREATE TRIGGER trg_notify_withdrawal_decision
  AFTER UPDATE OF status ON withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_withdrawal_decision();
