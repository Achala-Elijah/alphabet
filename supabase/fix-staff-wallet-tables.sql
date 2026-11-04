-- Fix: two tables from supabase/schema.sql are missing in this project.
--
--   public.transactions -> staff wallet history (deposits & withdrawals)
--   public.bets         -> staff bet history
--
-- Without them every staff deposit/withdraw fails with
--   "Could not find the table 'public.transactions' in the schema cache"
-- and the staff wallet history renders empty.
--
-- Safe to run multiple times.

do $$ begin
  create type public.transaction_type as enum ('deposit', 'withdrawal', 'bet_stake', 'payout', 'refund');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bet_status as enum ('open', 'won', 'lost', 'void', 'cashout');
exception when duplicate_object then null; end $$;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  type public.transaction_type not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending',
  reference text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  stake numeric(12,2) not null check (stake > 0),
  potential_return numeric(12,2) not null check (potential_return >= 0),
  status public.bet_status not null default 'open',
  selections jsonb not null default '[]'::jsonb,
  placed_at timestamptz not null default now(),
  settled_at timestamptz
);

alter table public.transactions enable row level security;
alter table public.bets enable row level security;

drop policy if exists "Users can view their transactions" on public.transactions;
create policy "Users can view their transactions"
  on public.transactions for select using (auth.uid() = user_id);

drop policy if exists "Users can view their bets" on public.bets;
create policy "Users can view their bets"
  on public.bets for select using (auth.uid() = user_id);

grant select on public.transactions to anon, authenticated;
grant select on public.bets to anon, authenticated;
grant all on public.transactions to service_role;
grant all on public.bets to service_role;
