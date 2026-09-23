DROP INDEX IF EXISTS customers_mobile_unique_idx;
DROP INDEX IF EXISTS customers_email_lower_idx;

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_mobile_combo_idx
  ON customers (mobile_number, lower(email_address));
