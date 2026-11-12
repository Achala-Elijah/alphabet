-- Sub-admin commissions: 65% of every referral deposit.
-- Run this once in the Supabase SQL Editor.
--
-- Rule: when a customer who joined via a sub-admin's referral link deposits,
--   - The user is credited 100% of the deposit (in their own wallet).
--   - The sub-admin earns an ADDITIONAL 65% of that deposit on top,
--     hidden from the user. The user's balance is never reduced. The
--     commission is recorded in this ledger only and is NOT added to the
--     staff wallet balance (the balance is reserved for in-app activity).
--
-- Example: referred user deposits GH₵ 100 → user +GH₵ 100, sub-admin +GH₵ 65.
--
-- How it's paid:
--   - At deposit settle time, `handleDepositCommission()` inserts a row
--     with reference = 'DEPCOM-' || deposit_reference. No staff wallet
--     balance is changed.
--   - The UNIQUE(reference) constraint makes it idempotent: one commission
--     per deposit, ever. Re-running the sweep is safe.
--   - Admin backfill sweep: POST /api/staff/commissions pays any pending
--     commissions for deposits that settled before this code shipped.
--
-- Changed from the previous flat "GH₵ 5 per active user" model — see
-- src/lib/limits.ts (COMMISSION_RATE = 0.65). Old flat-rate rows (if any)
-- remain in the table with type='activation' and are harmless.

drop table if exists public.commissions;

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.customer_accounts(id) on delete cascade,
  sub_admin_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'GHS' check (currency in ('GHS', 'NGN')),
  status text not null default 'completed' check (status in ('pending', 'completed', 'reversed')),
  reference text unique,
  deposit_reference text,
  type text not null default 'deposit_commission',
  created_at timestamptz not null default now()
);

create index if not exists commissions_sub_admin_created_idx on public.commissions (sub_admin_id, created_at desc);
create index if not exists commissions_user_idx on public.commissions (user_id);
create index if not exists commissions_deposit_ref_idx on public.commissions (deposit_reference) where deposit_reference is not null;

alter table public.commissions enable row level security;

-- Sub-admins can read their own commissions. All writes happen server-side
-- via the commissions service using SUPABASE_SERVICE_ROLE_KEY.
drop policy if exists "Staff can view own commissions" on public.commissions;
create policy "Staff can view own commissions"
  on public.commissions for select using (auth.uid() = sub_admin_id);

-- Make the new table visible to PostgREST immediately (fixes
-- "Could not find the table 'public.commissions' in the schema cache").
notify pgrst, 'reload schema';

-- The commission is 65% of the deposit, hidden from the user:
--   referred user deposits D → user credited 1.00 * D
--                            sub-admin credited 0.65 * D (in their own wallet)
-- No money is ever deducted from the user for commissions.
