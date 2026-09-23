# Elva Investa — Admin Portal

Internal operations console for the same Supabase project used by the [Elva Investa mobile app](https://github.com/pakashiva/Elva-Investa-mobile-app). This folder is a separate web app. Do not merge it with the mobile repository.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173

```bash
npm run typecheck
npm run build
```

## Environment

Copy `.env.example` to `.env`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

Never put a service-role key in Vite env vars.

## Database

Run `supabase/migrations/013_admin_portal.sql` in the Supabase SQL Editor (same project as the mobile app). Then allow-list an operator:

```sql
INSERT INTO public.admin_users (user_id, role, full_name, is_active)
SELECT id, 'super_admin', 'Your Name', TRUE
FROM auth.users
WHERE lower(email) = 'you@example.com'
ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, is_active = TRUE;
```

Investor RLS is unchanged. Admins get additional SELECT policies plus `SECURITY DEFINER` RPCs that call `is_admin()`.

See `ARCHITECTURE.md` for KPI definitions and business rules.
