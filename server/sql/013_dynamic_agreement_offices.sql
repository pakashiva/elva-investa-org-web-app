ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS agreement_offices JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE client_settings s
SET agreement_offices = offices.docs
FROM (
  SELECT
    client_id,
    jsonb_agg(office ORDER BY sort_order) AS docs
  FROM (
    SELECT
      client_id,
      1 AS sort_order,
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'placeName', 'Ballari',
        'address', btrim(second_party_ballari_address),
        'phone', right(regexp_replace(COALESCE(second_party_ballari_phone, ''), '\D', '', 'g'), 10),
        'email', lower(btrim(second_party_ballari_email)),
        'noticeDays', 30
      ) AS office
    FROM client_settings
    WHERE btrim(COALESCE(second_party_ballari_address, '')) <> ''
    UNION ALL
    SELECT
      client_id,
      2 AS sort_order,
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'placeName', 'Raichur',
        'address', btrim(second_party_raichur_address),
        'phone', right(regexp_replace(COALESCE(second_party_raichur_phone, ''), '\D', '', 'g'), 10),
        'email', lower(btrim(second_party_raichur_email)),
        'noticeDays', 60
      ) AS office
    FROM client_settings
    WHERE btrim(COALESCE(second_party_raichur_address, '')) <> ''
  ) parts
  GROUP BY client_id
) offices
WHERE s.client_id = offices.client_id
  AND COALESCE(jsonb_array_length(s.agreement_offices), 0) = 0;

ALTER TABLE client_settings
  DROP COLUMN IF EXISTS second_party_ballari_address,
  DROP COLUMN IF EXISTS second_party_ballari_phone,
  DROP COLUMN IF EXISTS second_party_ballari_email,
  DROP COLUMN IF EXISTS second_party_raichur_address,
  DROP COLUMN IF EXISTS second_party_raichur_phone,
  DROP COLUMN IF EXISTS second_party_raichur_email;

ALTER TABLE investment_agreements
  DROP CONSTRAINT IF EXISTS investment_agreements_branch_check;

ALTER TABLE investment_agreements
  ADD COLUMN IF NOT EXISTS notice_days INTEGER;

UPDATE investment_agreements
SET notice_days = COALESCE(
  notice_days,
  CASE WHEN lower(branch) = 'raichur' THEN 60 ELSE 30 END
);

UPDATE investment_agreements
SET branch = 'Raichur'
WHERE lower(branch) = 'raichur';

UPDATE investment_agreements
SET branch = 'Ballari'
WHERE lower(branch) = 'ballari';
