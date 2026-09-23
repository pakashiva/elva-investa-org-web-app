CREATE UNIQUE INDEX IF NOT EXISTS customers_id_client_idx
  ON customers (id, client_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investments_customer_client_fk'
  ) THEN
    ALTER TABLE investments
      ADD CONSTRAINT investments_customer_client_fk
      FOREIGN KEY (customer_id, client_id)
      REFERENCES customers (id, client_id)
      ON DELETE RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'withdrawals'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'withdrawals_customer_client_fk'
  ) THEN
    ALTER TABLE withdrawals
      ADD CONSTRAINT withdrawals_customer_client_fk
      FOREIGN KEY (customer_id, client_id)
      REFERENCES customers (id, client_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;
