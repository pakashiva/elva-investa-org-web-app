-- Fix partial withdrawal Approve.
-- Full withdrawals only close the investment (already works).
-- Partial Approve needs process_investment_interest(), which was missing
-- and caused: "function ... does not exist".
-- Safe to re-run. Matches mobile migration 012.

CREATE OR REPLACE FUNCTION public.process_investment_interest(p_investment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  v_days INTEGER;
  v_completed_periods INTEGER;
  v_new_periods INTEGER;
  v_monthly_interest NUMERIC(15, 2);
  v_monthly_tds NUMERIC(15, 2);
  v_monthly_net NUMERIC(15, 2);
BEGIN
  SELECT
    id,
    fund_amount,
    interest_rate,
    tds_percent,
    invested_date,
    completed_interest_periods,
    total_earnings,
    tds_deducted_amount
  INTO inv
  FROM public.investments
  WHERE id = p_investment_id
    AND status = 'Active'
    AND invested_date IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_days := CURRENT_DATE - inv.invested_date;

  IF v_days < 30 THEN
    RETURN;
  END IF;

  v_completed_periods := v_days / 30;
  v_new_periods := v_completed_periods - inv.completed_interest_periods;

  IF v_new_periods <= 0 THEN
    RETURN;
  END IF;

  v_monthly_interest := ROUND(inv.fund_amount * inv.interest_rate, 2);
  v_monthly_tds := ROUND(v_monthly_interest * inv.tds_percent, 2);
  v_monthly_net := v_monthly_interest - v_monthly_tds;

  UPDATE public.investments
  SET
    completed_interest_periods = v_completed_periods,
    tds_deducted_amount = inv.tds_deducted_amount + (v_monthly_tds * v_new_periods),
    total_earnings = inv.total_earnings + (v_monthly_net * v_new_periods),
    current_value = inv.fund_amount + inv.total_earnings + (v_monthly_net * v_new_periods),
    updated_at = NOW()
  WHERE id = inv.id
    AND completed_interest_periods = inv.completed_interest_periods;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_investment_on_withdrawal_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
  v_new_principal NUMERIC(15, 2);
BEGIN
  IF NEW.status = 'Approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NEW.strategy = 'partial' THEN
      PERFORM public.process_investment_interest(NEW.investment_id);

      SELECT
        id,
        fund_amount,
        total_earnings
      INTO v_inv
      FROM public.investments
      WHERE id = NEW.investment_id
        AND status = 'Active'
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN NEW;
      END IF;

      v_new_principal := v_inv.fund_amount - NEW.withdrawal_amount;

      IF v_new_principal < 100000 THEN
        RAISE EXCEPTION 'Partial withdrawal would leave principal below minimum balance.';
      END IF;

      UPDATE public.investments
      SET
        fund_amount = v_new_principal,
        invested_date = CURRENT_DATE,
        completed_interest_periods = 0,
        current_value = v_new_principal + COALESCE(total_earnings, 0),
        updated_at = NOW()
      WHERE id = NEW.investment_id
        AND status = 'Active';
    ELSE
      UPDATE public.investments
      SET status = 'Closed', updated_at = NOW()
      WHERE id = NEW.investment_id
        AND status = 'Active';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawal_approved_close_investment ON public.withdrawals;
CREATE TRIGGER trg_withdrawal_approved_close_investment
  AFTER INSERT OR UPDATE OF status ON public.withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.close_investment_on_withdrawal_approved();
