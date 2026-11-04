-- Payments layer: deposit intents for staff and customer wallets.
-- Run this once in the Supabase SQL Editor before switching PAYMENT_PROVIDER
-- away from "manual" (see src/lib/payments/README.md).

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  provider text not null default 'manual',
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'GHS' check (currency in ('GHS', 'NGN')),
  staff_id uuid references public.profiles(id) on delete cascade,
  account_id uuid references public.customer_accounts(id) on delete cascade,
  checkout_url text,
  provider_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposits_subject_check check ((staff_id is null) <> (account_id is null))
);

create index if not exists deposits_staff_created_idx on public.deposits (staff_id, created_at desc);
create index if not exists deposits_account_created_idx on public.deposits (account_id, created_at desc);
create index if not exists deposits_status_idx on public.deposits (status);

alter table public.deposits enable row level security;

-- Owners can read their own deposit intents. All writes happen server-side
-- through the payment API using SUPABASE_SERVICE_ROLE_KEY.
drop policy if exists "Staff can view own deposits" on public.deposits;
create policy "Staff can view own deposits"
  on public.deposits for select using (auth.uid() = staff_id);
