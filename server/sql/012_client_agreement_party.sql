ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS second_party_name TEXT,
  ADD COLUMN IF NOT EXISTS second_party_ballari_address TEXT,
  ADD COLUMN IF NOT EXISTS second_party_ballari_phone TEXT,
  ADD COLUMN IF NOT EXISTS second_party_ballari_email TEXT,
  ADD COLUMN IF NOT EXISTS second_party_raichur_address TEXT,
  ADD COLUMN IF NOT EXISTS second_party_raichur_phone TEXT,
  ADD COLUMN IF NOT EXISTS second_party_raichur_email TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_name TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_aadhaar TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_pan TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_relation TEXT,
  ADD COLUMN IF NOT EXISTS second_party_nominee_phone TEXT;

UPDATE client_settings s
SET
  second_party_name = 'Mr. VENKATESH C',
  second_party_ballari_address = 'Basava Krupa, 1st Floor, House No 13, Ward No 32, Sanjay Gandhi Nagar, Opposite Fire station, Infantry Road, Ballari District, Karnataka-583104',
  second_party_ballari_phone = '8123852228',
  second_party_ballari_email = 'venkateshtradersc@gmail.com',
  second_party_raichur_address = 'Shop No: 13, 1st Floor, Santoshi Hub, Gandhi Chowk, Raichur-District, Karnataka-584101',
  second_party_raichur_phone = '7795707027',
  second_party_raichur_email = 'venkatesh.venku939@gmail.com',
  second_party_nominee_name = 'K C Rama Krishna',
  second_party_nominee_aadhaar = '243721867145',
  second_party_nominee_pan = 'CIEPR7427L',
  second_party_nominee_relation = 'Brother',
  second_party_nominee_phone = '9900210713'
FROM clients c
WHERE c.id = s.client_id
  AND lower(c.client_code) = 'vtinvest'
  AND (s.second_party_name IS NULL OR btrim(s.second_party_name) = '');
