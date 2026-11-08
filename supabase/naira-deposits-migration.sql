-- Manual Naira deposits: customers send money to the OPay account and
-- upload a screenshot; an admin reviews and approves/rejects here.
-- Run once in the Supabase SQL Editor.
create table if not exists public.naira_deposits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  screenshot_data text,
  reference text,
  note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.naira_deposits enable row level security;
-- No policies on purpose: only the service role (via the API routes)
-- reads/writes this table, exactly like deposits and the football cache.
