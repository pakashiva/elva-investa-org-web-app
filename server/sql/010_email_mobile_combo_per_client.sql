DROP INDEX IF EXISTS customers_email_mobile_combo_idx;

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_mobile_combo_idx
  ON customers (client_id, mobile_number, lower(email_address));
