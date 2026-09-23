-- Remove ₹1L minimum remaining principal rule for partial withdrawals

CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_principal NUMERIC(15, 2);
  v_total_earnings NUMERIC(15, 2);
  v_current_value NUMERIC(15, 2);
  v_full_amount NUMERIC(15, 2);
  v_open_full_count INTEGER;
  v_open_partial_sum NUMERIC(15, 2);
  v_available_principal NUMERIC(15, 2);
BEGIN
  SELECT fund_amount, total_earnings, current_value
  INTO v_principal, v_total_earnings, v_current_value
  FROM public.investments
  WHERE id = NEW.investment_id
    AND user_id = NEW.user_id
    AND status = 'Active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active investment not found for withdrawal.';
  END IF;

  SELECT COUNT(*)
  INTO v_open_full_count
  FROM public.withdrawals
  WHERE investment_id = NEW.investment_id
    AND status IN ('Processing', 'Approved')
    AND strategy = 'full';

  IF v_open_full_count > 0 THEN
    RAISE EXCEPTION 'A full withdrawal request is already open for this fund. Wait for it to be rejected before requesting again.';
  END IF;

  SELECT COALESCE(SUM(withdrawal_amount), 0)
  INTO v_open_partial_sum
  FROM public.withdrawals
  WHERE investment_id = NEW.investment_id
    AND status = 'Processing'
    AND strategy = 'partial';

  v_available_principal := v_principal - v_open_partial_sum;

  IF NEW.strategy = 'partial' THEN
    IF NEW.withdrawal_amount <= 0 THEN
      RAISE EXCEPTION 'Withdrawal amount must be greater than zero.';
    END IF;

    IF NEW.withdrawal_amount > v_available_principal THEN
      RAISE EXCEPTION 'Withdrawal amount exceeds available principal for this fund (₹%).',
        to_char(GREATEST(v_available_principal, 0), 'FM9999999990.00');
    END IF;

    IF NEW.withdrawal_amount >= v_principal THEN
      RAISE EXCEPTION 'Use full withdrawal to withdraw the entire principal.';
    END IF;
  ELSE
    IF v_open_partial_sum > 0 THEN
      RAISE EXCEPTION 'Clear or wait for open partial withdrawal requests before requesting a full withdrawal.';
    END IF;

    v_full_amount := COALESCE(v_current_value, v_principal + COALESCE(v_total_earnings, 0));
    IF ABS(NEW.withdrawal_amount - v_full_amount) > 0.01 THEN
      RAISE EXCEPTION 'Full withdrawal amount must equal current investment value.';
    END IF;
  END IF;

  RETURN NEW;
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

      IF v_new_principal <= 0 THEN
        RAISE EXCEPTION 'Partial withdrawal would leave no principal. Use full withdrawal instead.';
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
