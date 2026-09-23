# Elva Investa Admin Portal — Architecture

This document is the implementation contract for the Admin Portal. The mobile app ([Elva-Investa-mobile-app](https://github.com/pakashiva/Elva-Investa-mobile-app)) is the source of truth for the existing database, APIs, naming, and business rules. This project must not copy or change that mobile codebase.

**Status:** Dashboard and Customers are implemented against live Supabase RPCs. Remaining nav items are placeholders until their designs arrive. Admin reads use `is_admin()` RLS + `SECURITY DEFINER` RPCs; no service-role key is shipped to the browser. Express is not required for these screens.

---

## 1. Product context

Elva Investa (mobile display name: **Venkatesh Traders**; legal copy: **Roxru Financial**) is an investment product for Indian users.

Investors:

1. Register with personal details, KYC (Aadhaar + PAN images), bank account, and nominee.
2. Verify mobile via Elvatech OTP.
3. Submit **fund requests** (minimum ₹1,00,000 + ₹1,550 agreement charges).
4. Earn **5% per month simple interest** on principal in **30-day periods**, minus **10% TDS** on gross interest, only while status is **Active**.
5. Request **full** or **partial** withdrawals.
6. Share an **8-character referral code**. Bonus is **1% of capital**, minus **2% TDS**, credited when the referred fund becomes **Active**.

The Admin Portal is the operator console for the **same Supabase project**. It reviews KYC/users, activates fund requests, processes withdrawals, inspects the ledger, and manages referral settings.

---

## 2. What this portal must never do

- Do not clone, import, or modify the mobile app.
- Do not replace Postgres/Supabase with MongoDB. The `mern` folder name is only the parent workspace; the live backend is **Supabase Postgres**.
- Do not insert `transactions` from application code. Ledger rows are created by existing database triggers.
- Do not change referral attribution after an investment is created (`referral_code` / `referrer_user_id` are immutable).
- Do not put `SUPABASE_SERVICE_ROLE_KEY` in the browser.
- Do not let investor accounts use this portal to read other users’ data.

---

## 3. Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript | Separate web admin UI; matches later design without Expo/React Native |
| Backend | Express + TypeScript | Holds the service-role key; admin authz; signed KYC URLs |
| Database | Existing Supabase Postgres | Same tables, RPCs, triggers as mobile |
| Auth | Supabase Auth + `admin_users` | Investors and admins share Auth; admins are an allow-listed role |
| Storage | Existing `kyc-documents` bucket | Private; admin reads via service role signed URLs |

Mobile stack reused conceptually: `@supabase/supabase-js`, same table/column names, same status enums, same money rules.

Suggested layout:

```
admin_portal/
  client/          # Vite React app (UI after design arrives)
  server/          # Express API (service role, never exposed to client)
  shared/          # Database types and domain constants
```

---

## 4. Data model (existing — reuse as-is)

All investor data already exists. Admin reads/writes these tables; it does not recreate them.

```
auth.users
    │
    ├── profiles (1:1, PK = user_id)
    ├── kyc_documents (1:1)
    ├── bank_accounts (1:N)
    ├── nominees (1:N)
    ├── referral_codes (1:1, 8-char A-Z0-9)
    ├── investments (1:N)
    │       ├── bank_account_id → bank_accounts
    │       ├── nominee_id → nominees
    │       └── referrer_user_id → auth.users (optional)
    ├── withdrawals (1:N)
    │       ├── investment_id → investments
    │       └── bank_account_id → bank_accounts
    ├── transactions (1:N, trigger-written)
    └── referral_rewards (N, one per credited investment)
            └── investment_id UNIQUE

referral_settings          (singleton id = 1)
password_reset_authorizations  (mobile OTP reset; not an admin table)
storage.kyc-documents      path = {user_id}/{document_type}.{ext}
```

### 4.1 Status machines (do not invent new values)

**Investment** `status`: `Pending` → `Active` → `Closed`

- Mobile insert: always `Pending`.
- Admin activates: `Pending` → `Active` and **must set `invested_date`** (interest will not accrue if this is null).
- Full withdrawal **Approved** trigger closes an **Active** investment.
- Partial withdrawal **Approved** keeps the investment **Active**, reduces `fund_amount`, resets `invested_date` to today, and resets `completed_interest_periods` to 0.

**Withdrawal** `status`: `Processing` → `Approved` → `Paid`  
Also: `Processing` → `Rejected`

- Mobile insert: always `Processing`. There is **no UPDATE RLS** for investors, so only service role (this portal) can change status.

**Transaction** `transaction_type`: `instant_credit` | `withdrawal` | `referral_bonus`  
**Transaction** `source_type`: `investment` | `withdrawal` | `referral`  
Unique on `(source_type, source_id)` — duplicate ledger rows are impossible.

**Referral reward** `status`: `credited` only (created by trigger on Active).

### 4.2 ID conventions

| Entity | Code |
| --- | --- |
| Investment | `INV-` + 6-digit sequence (starts at 200) |
| Transaction | `TXN-` + 6-digit sequence (starts at 894721) |
| Referral code | 8-char uppercase alphanumeric |

---

## 5. Business rules the admin API must honor

### Registration / KYC

- Profile fields: `full_name`, `mobile_number`, `email_address`, `date_of_birth`, `address`, `city`, `state`, `pin_code`, `authorized`, `mobile_verified`.
- `authorized` = investor accepted T&C at signup (not an admin-approval flag).
- `mobile_verified` is set by mobile RPC `mark_mobile_verified()`, not by this portal.
- KYC: `aadhaar_number`, `pan_number`, images at `{user_id}/aadhaar_front|aadhaar_back|pan_card.{ext}`.
- Bank: `Savings` | `Current`; `is_primary`.
- Nominee: name, relationship, Aadhaar, percentage.
- Password lives only in `auth.users` (min 8 chars; mobile also requires uppercase, number, special).

### Investments

- Minimum principal: **₹100,000**.
- Agreement charges: **₹1,550** (stored on the investment; payable total shown in mobile = principal + charges).
- Default `interest_rate = 0.05`, `tds_percent = 0.10`.
- Pay date is auto-set by mobile as **today + 3 days**.
- Optional `referral_code`; server trigger validates format, existence, and no self-referral, then sets `referrer_user_id`.

Interest (existing RPC / trigger logic):

```
monthly_interest = ROUND(fund_amount * interest_rate, 2)
monthly_tds      = ROUND(monthly_interest * tds_percent, 2)
monthly_net      = monthly_interest - monthly_tds
current_value    = fund_amount + total_earnings
```

Periods = `floor((today - invested_date) / 30)`. Only **Active** rows with `invested_date` accrue.

### Withdrawals

- **Full:** amount must equal `current_value` (principal + earnings). Approval **closes** the investment.
- **Partial:** amount &lt; principal; remaining principal **≥ ₹100,000**. Approval reduces principal and restarts the interest clock. Earnings already credited are kept.
- `net_payout` is nullable until admin sets it (ledger uses `COALESCE(net_payout, withdrawal_amount)` when status becomes **Paid**).

### Referrals

- Settings singleton: `referral_rate = 0.01`, `tds_rate = 0.02` (admin may update this row).
- Bonus = `ROUND(fund_amount * rate, 2)` then TDS on that bonus; net credited to **referrer**.
- Pending referral earnings = Pending investments that already have `referrer_user_id` but no `referral_rewards` row yet.
- Total referrals = **distinct** `referred_user_id`.

### Side effects (database — do not reimplement in JS)

| Admin action | Existing trigger |
| --- | --- |
| Investment → `Active` | Instant Credit transaction; referral reward + Referral Bonus transaction |
| Withdrawal → `Approved` (full) | Linked Active investment → `Closed` |
| Withdrawal → `Approved` (partial) | Accrue due interest, reduce principal, reset period clock |
| Withdrawal → `Paid` | Withdrawal transaction |

---

## 6. Why a backend is required (RLS)

Mobile RLS is **own-row only** (`auth.uid() = user_id`). Investors cannot:

- List other users, all investments, or all withdrawals
- Update withdrawal status (no UPDATE policy)
- Insert/update/delete `transactions`
- Read other users’ KYC files

The publishable key is therefore **not sufficient** for admin work.

```
Browser (admin UI)
    │  JWT of logged-in admin
    ▼
Express API
    │  1. Validate Supabase JWT
    │  2. Require row in admin_users (is_active)
    │  3. Query/mutate with SERVICE ROLE (bypasses RLS)
    ▼
Supabase Postgres + Storage
```

---

## 7. Admin-only schema (additive — new, does not change mobile tables)

Apply these in the **same** Supabase project. They are owned by this portal, not by the mobile repo.

### `admin_users`

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | UUID PK → `auth.users` | Admin identity |
| `role` | TEXT | `super_admin` \| `operator` |
| `full_name` | TEXT | |
| `is_active` | BOOLEAN | Soft disable without deleting Auth user |
| `created_at` | TIMESTAMPTZ | |

Seed admins manually (SQL / dashboard). Do not open public self-registration.

### `admin_audit_logs`

Every status change and settings update:

- `admin_user_id`, `action`, `entity_type`, `entity_id`
- `before_json`, `after_json`, `created_at`

### Suggested roles

| Role | Capabilities |
| --- | --- |
| `operator` | View all data; activate/reject funds; approve/reject/pay withdrawals; view KYC |
| `super_admin` | Operator + manage `admin_users` + update `referral_settings` |

---

## 8. Admin API surface (no UI yet)

All routes require a valid admin session.

| Area | Operations |
| --- | --- |
| Auth | Sign in (Supabase email/password), sign out, `GET /me` |
| Dashboard | Aggregates: users, pending funds, processing withdrawals, AUM (`SUM(fund_amount)` where Active), paid-out withdrawals, referral bonuses |
| Users | List/search profiles; detail with KYC, banks, nominees, investments, withdrawals, transactions, referral code |
| KYC | Signed URLs for Aadhaar/PAN images |
| Investments | List by status; activate (`Pending` → `Active` + `invested_date`); optional reject path only if product later adds a status (today Closed is for completed funds, not rejection) |
| Withdrawals | List by status; `Approved` / `Rejected` / `Paid`; set `net_payout` and `status_date` |
| Transactions | Read-only ledger, filter by user/type/date |
| Referrals | List codes, rewards, pending attributed funds; `super_admin` updates `referral_settings` |
| Admins | `super_admin` CRUD on `admin_users` |

### Activate fund request (required fields)

```
UPDATE investments
SET status = 'Active',
    invested_date = :activationDate,   -- typically CURRENT_DATE
    current_value = fund_amount + COALESCE(total_earnings, 0),
    updated_at = NOW()
WHERE id = :id AND status = 'Pending';
```

Triggers then write Instant Credit and (if referred) referral reward.

### Withdrawal transitions

```
Processing → Approved   (sets status_date; trigger mutates investment)
Processing → Rejected   (sets status_date; investment unchanged)
Approved   → Paid       (sets net_payout if needed; trigger writes TXN)
```

Do not skip `Approved` for full withdrawals if the close-on-approve trigger must run. For payout, **Paid** is what creates the ledger debit.

---

## 9. Authentication / authorization

**Investor app:** email+password, then Elvatech OTP for `mobile_verified`. Forgot-password uses OTP + `complete_password_recovery`.

**Admin portal:** email+password against the **same** Supabase Auth project, then server checks `admin_users`.

- No OTP flow in admin (unless design asks later).
- An investor JWT without `admin_users` is rejected with 403.
- Prefer creating **dedicated admin Auth users**, not promoting investor accounts.
- Session: frontend uses `@supabase/supabase-js` (anon/publishable key) only for `signInWithPassword` / `getSession`. All business data goes through Express with `Authorization: Bearer <access_token>`.

---

## 10. Frontend architecture (deferred until UI design)

When design arrives, map screens to the API above. Expected domains (not a visual spec):

- Sign in
- Dashboard
- Users / KYC review
- Fund requests (Pending queue) and investment detail
- Withdrawals queue and detail
- Transactions
- Referrals and settings
- Admin users (super_admin)

Shared constants live in `shared/` so UI labels match mobile: INR formatting (`en-IN`), status labels, `AGREEMENT_CHARGES`, `FUND_AMOUNT_MINIMUM`.

Brand tokens from mobile (for later theming, not a layout):

- Primary `#2B2D6B`, success `#22A06B`, pending `#C47A00`, danger `#FF3B30`

---

## 11. Environment

```
# Client (Vite) — public
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_API_URL=http://localhost:4000

# Server — secret
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PORT=4000
```

Never commit service role or OTP keys. Admin does not need Elvatech OTP unless a future design adds it.

---

## 12. Implementation sequence (after UI design)

1. Additive SQL: `admin_users`, `admin_audit_logs`; seed first super_admin.
2. Express: auth middleware, domain services that wrap existing tables/triggers.
3. Shared TypeScript types aligned with mobile `database.ts`.
4. React UI matching the provided design, calling only the admin API.
5. Verify each admin action against trigger side effects (Active → TXN + referral; Approved → close/partial; Paid → TXN).
