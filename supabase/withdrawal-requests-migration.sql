-- Manual-review withdrawal requests.
-- Run this once in the Supabase SQL Editor.
--
-- Flow:
--   1. User requests a withdrawal -> row inserted with status 'pending',
--      balance is debited (reserved) immediately.
--   2. Staff reviews the request in /sub-admin/withdrawals (or /api/staff/withdrawals).
--   3. Staff approves -> status 'approved' (payout sent manually via MoMo/bank).
--   4. Staff marks completed -> status 'completed' (no further balance change).
--   5. Staff rejects -> status 'rejected', funds returned to wallet.
--   6. User cancels a pending request -> status 'cancelled', funds returned.
--
-- 'rejected' and 'cancelled' both return funds; keeping them as separate
-- statuses lets you see *why* funds came back.

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'GHS' check (currency in ('GHS', 'NGN')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'completed', 'rejected', 'cancelled', 'failed')),
  reference text unique,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists withdrawal_requests_account_created_idx on public.withdrawal_requests (account_id, created_at desc);
create index if not exists withdrawal_requests_status_idx on public.withdrawal_requests (status, created_at desc);

alter table public.withdrawal_requests enable row level security;

-- Owners can read their own withdrawal requests. All writes happen server-side
-- through the withdrawal API using SUPABASE_SERVICE_ROLE_KEY.
drop policy if exists "Staff can view own withdrawal requests" on public.withdrawal_requests;
create policy "Staff can view own withdrawal requests"
  on public.withdrawal_requests for select using (auth.uid() = reviewed_by);

-- Customer transaction history should show withdrawals as 'pending' until
-- staff resolves them, so users see their request is processing.
-- The customer_transactions.type='withdrawal' row mirrors this lifecycle:
--   pending -> approved -> completed (no extra debit, already deducted)
--   pending -> rejected / cancelled (refund row inserted)
