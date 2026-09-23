ALTER TABLE nominees
  ADD COLUMN IF NOT EXISTS nominee_pan TEXT;

ALTER TABLE nominees
  ADD COLUMN IF NOT EXISTS nominee_mobile TEXT;
