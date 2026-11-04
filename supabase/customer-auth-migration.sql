-- Run this once in Supabase SQL Editor after supabase/schema.sql.
-- Select all of this file before clicking Run; the editor may otherwise run only the statement at the cursor.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  phone text not null unique,
  password_hash text not null,
  email text,
  currency text not null default 'GHS' check (currency in ('GHS', 'NGN')),
  role text not null default 'user' check (role = 'user'),
  balance numeric(12,2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_accounts add column if not exists email text;
alter table public.customer_accounts add column if not exists currency text not null default 'GHS';
alter table public.customer_accounts drop constraint if exists customer_accounts_currency_check;
alter table public.customer_accounts add constraint customer_accounts_currency_check check (currency in ('GHS', 'NGN'));

-- Customer accounts never receive staff roles. Staff profiles are created and
-- promoted separately by an administrator.

alter table public.matches add column if not exists current_minute integer not null default 0;
alter table public.matches add column if not exists scheduled_goals jsonb not null default '[]'::jsonb;

create table if not exists public.match_scheduled_goals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  minute integer not null check (minute >= 0 and minute <= 120),
  team text not null check (team in ('home', 'away')),
  created_at timestamptz not null default now()
);

create table if not exists public.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_bets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts(id) on delete cascade,
  stake numeric(12,2) not null check (stake > 0),
  potential_return numeric(12,2) not null,
  status text not null default 'open',
  selections jsonb not null default '[]'::jsonb,
  placed_at timestamptz not null default now()
);

create table if not exists public.customer_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts(id) on delete cascade,
  type text not null,
  amount numeric(12,2) not null,
  status text not null default 'completed',
  reference text,
  created_at timestamptz not null default now()
);

create or replace function public.customer_register(
  p_username text,
  p_phone text,
  p_password text
)
returns uuid
language plpgsql
security definer set search_path = public, extensions
as $$
declare new_id uuid;
begin
  if length(trim(p_username)) < 3 or length(trim(p_phone)) < 7 or length(p_password) < 6 then
    raise exception 'Username, phone, and password are invalid';
  end if;
  if exists (
    select 1 from public.customer_accounts
    where username = lower(trim(p_username)) or phone = trim(p_phone)
  ) then
    raise exception 'An account with that username or phone already exists';
  end if;
  insert into public.customer_accounts(username, phone, password_hash)
  values (lower(trim(p_username)), trim(p_phone), extensions.crypt(p_password, extensions.gen_salt('bf')))
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.customer_login(
  p_phone text,
  p_password text,
  p_token_hash text
)
returns table (account_id uuid, username text)
language plpgsql
security definer set search_path = public, extensions
as $$
declare found_id uuid;
begin
  select ca.id into found_id
  from public.customer_accounts ca
  where ca.phone = trim(p_phone)
    and ca.password_hash = extensions.crypt(p_password, ca.password_hash);
  if found_id is null then raise exception 'Invalid phone number or password'; end if;
  insert into public.customer_sessions(account_id, token_hash, expires_at)
  values (found_id, p_token_hash, now() + interval '30 days');
  return query
    select ca.id, ca.username
    from public.customer_accounts ca
    where ca.id = found_id;
end;
$$;

-- Postgres cannot change a function's return type with CREATE OR REPLACE.
-- Drop the old 5-column version first, then recreate with `phone` included.
drop function if exists public.customer_session(text);
create or replace function public.customer_session(p_token_hash text)
returns table (account_id uuid, username text, balance numeric, email text, currency text, phone text)
language sql security definer set search_path = public
as $$
  select ca.id, ca.username, ca.balance, ca.email, ca.currency, ca.phone
  from public.customer_sessions cs
  join public.customer_accounts ca on ca.id = cs.account_id
  where cs.token_hash = p_token_hash and cs.expires_at > now();
$$;

create or replace function public.customer_update_profile(p_account_id uuid, p_currency text, p_email text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_currency not in ('GHS', 'NGN') then raise exception 'Unsupported currency'; end if;
  update public.customer_accounts
  set currency = p_currency, email = nullif(trim(p_email), ''), updated_at = now()
  where id = p_account_id;
end;
$$;

create or replace function public.customer_logout(p_token_hash text)
returns void language sql security definer set search_path = public
as $$ delete from public.customer_sessions where token_hash = p_token_hash; $$;

create or replace function public.customer_place_bet(
  p_account_id uuid,
  p_stake numeric,
  p_potential_return numeric,
  p_selections jsonb
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare new_bet_id uuid; current_balance numeric;
begin
  select balance into current_balance
  from public.customer_accounts
  where id = p_account_id for update;
  if current_balance is null or current_balance < p_stake then
    raise exception 'Insufficient balance';
  end if;
  insert into public.customer_bets(account_id, stake, potential_return, selections)
  values (p_account_id, p_stake, p_potential_return, p_selections)
  returning id into new_bet_id;
  insert into public.customer_transactions(account_id, type, amount, status, reference)
  values (p_account_id, 'bet_stake', p_stake, 'completed', 'BET-' || new_bet_id);
  update public.customer_accounts
  set balance = balance - p_stake, updated_at = now()
  where id = p_account_id;
  return jsonb_build_object('id', new_bet_id, 'status', 'open', 'stake', p_stake, 'potential_return', p_potential_return);
end;
$$;

create or replace function public.customer_transaction_history(p_account_id uuid)
returns setof public.customer_transactions
language sql security definer set search_path = public
as $$
  select *
  from public.customer_transactions
  where account_id = p_account_id
  order by created_at desc;
$$;

create or replace function public.customer_bet_history(p_account_id uuid)
returns setof public.customer_bets
language sql
security definer set search_path = public
as $$
  select *
  from public.customer_bets
  where account_id = p_account_id
  order by placed_at desc;
$$;

grant execute on function public.customer_register(text,text,text) to anon, authenticated;
grant execute on function public.customer_login(text,text,text) to anon, authenticated;
grant execute on function public.customer_session(text) to anon, authenticated;
grant execute on function public.customer_update_profile(uuid,text,text) to anon, authenticated;
grant execute on function public.customer_logout(text) to anon, authenticated;
grant execute on function public.customer_place_bet(uuid,numeric,numeric,jsonb) to anon, authenticated;
grant execute on function public.customer_transaction_history(uuid) to anon, authenticated;
grant execute on function public.customer_bet_history(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
