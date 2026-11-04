create type public.app_role as enum ('user', 'admin', 'sub_admin');
create type public.match_source as enum ('SportScore', 'BETKIING');
create type public.match_status as enum ('scheduled', 'live', 'finished', 'cancelled');
create type public.bet_status as enum ('open', 'won', 'lost', 'void', 'cashout');
create type public.transaction_type as enum ('deposit', 'withdrawal', 'bet_stake', 'payout', 'refund');

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  phone text,
  role public.app_role not null default 'user',
  balance numeric(12,2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  competition text not null,
  home text not null,
  away text not null,
  home_score integer,
  away_score integer,
  current_minute integer not null default 0 check (current_minute >= 0),
  scheduled_goals jsonb not null default '[]'::jsonb,
  status public.match_status not null default 'scheduled',
  kickoff timestamptz not null,
  source public.match_source not null default 'BETKIING',
  is_featured boolean not null default false,
  odds jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.match_scheduled_goals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  minute integer not null check (minute >= 0 and minute <= 120),
  team text not null check (team in ('home', 'away')),
  created_at timestamptz not null default now()
);

create table public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  stake numeric(12,2) not null check (stake > 0),
  potential_return numeric(12,2) not null check (potential_return >= 0),
  status public.bet_status not null default 'open',
  selections jsonb not null default '[]'::jsonb,
  placed_at timestamptz not null default now(),
  settled_at timestamptz
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  type public.transaction_type not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending',
  reference text unique,
  created_at timestamptz not null default now()
);

create table public.customer_accounts (
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

create table public.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.customer_bets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts(id) on delete cascade,
  stake numeric(12,2) not null check (stake > 0),
  potential_return numeric(12,2) not null,
  status public.bet_status not null default 'open',
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
create index customer_sessions_token_idx on public.customer_sessions(token_hash);
alter table public.customer_accounts enable row level security;
alter table public.customer_sessions enable row level security;

create index matches_sport_status_kickoff_idx on public.matches (sport, status, kickoff);
create index matches_featured_idx on public.matches (is_featured, kickoff);
create index bets_user_status_idx on public.bets (user_id, status);
create index transactions_user_created_idx on public.transactions (user_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, phone)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.prevent_non_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
    and not exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    ) then
    raise exception 'Only an admin can change staff roles';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute procedure public.prevent_non_admin_role_change();

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_scheduled_goals enable row level security;
alter table public.bets enable row level security;
alter table public.transactions enable row level security;

create policy "Staff can view customer accounts"
  on public.customer_accounts for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'sub_admin'))
  );
create policy "Staff can view customer bets"
  on public.customer_bets for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'sub_admin'))
  );
create policy "Staff can view customer transactions"
  on public.customer_transactions for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'sub_admin'))
  );

create policy "Profiles are viewable by their owner"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update their profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Matches are public"
  on public.matches for select using (true);
create policy "Scheduled goals are public"
  on public.match_scheduled_goals for select using (true);
create policy "Staff can insert scheduled goals"
  on public.match_scheduled_goals for insert with check (public.is_staff());
create policy "Staff can delete scheduled goals"
  on public.match_scheduled_goals for delete using (public.is_staff());
create policy "Admins can manage matches"
  on public.matches for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'sub_admin'))
  );
create policy "Staff can delete matches"
  on public.matches for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'sub_admin'))
  );
create policy "Users can view their bets"
  on public.bets for select using (auth.uid() = user_id);
create policy "Users can view their transactions"
  on public.transactions for select using (auth.uid() = user_id);

create or replace function public.is_staff()
returns boolean
language sql
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'sub_admin')
  );
$$;

create or replace function public.place_bet(
  p_stake numeric,
  p_potential_return numeric,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric;
  new_bet public.bets;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to place a bet';
  end if;
  if p_stake is null or p_stake <= 0 or p_potential_return is null or p_potential_return <= 0 then
    raise exception 'Invalid bet amount';
  end if;
  if p_selections is null or jsonb_array_length(p_selections) = 0 then
    raise exception 'A bet must contain at least one selection';
  end if;

  select balance into current_balance
  from public.profiles
  where id = auth.uid()
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;
  if current_balance < p_stake then
    raise exception 'Insufficient balance';
  end if;

  insert into public.bets (user_id, stake, potential_return, selections)
  values (auth.uid(), p_stake, p_potential_return, p_selections)
  returning * into new_bet;

  update public.profiles
  set balance = balance - p_stake, updated_at = now()
  where id = auth.uid();

  insert into public.transactions (user_id, type, amount, status, reference)
  values (auth.uid(), 'bet_stake', p_stake, 'completed', 'BET-' || new_bet.id);

  return jsonb_build_object(
    'id', new_bet.id,
    'status', new_bet.status,
    'stake', new_bet.stake,
    'potential_return', new_bet.potential_return
  );
end;
$$;

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
  if exists (select 1 from customer_accounts where username = lower(trim(p_username)) or phone = trim(p_phone)) then
    raise exception 'An account with that username or phone already exists';
  end if;
  insert into customer_accounts(username, phone, password_hash)
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
  select id into found_id from customer_accounts
  where phone = trim(p_phone) and password_hash = extensions.crypt(p_password, password_hash);
  if found_id is null then raise exception 'Invalid phone number or password'; end if;
  insert into customer_sessions(account_id, token_hash, expires_at)
  values (found_id, p_token_hash, now() + interval '30 days');
  return query select id, customer_accounts.username from customer_accounts where id = found_id;
end;
$$;

drop function if exists public.customer_session(text);
create or replace function public.customer_session(p_token_hash text)
returns table (account_id uuid, username text, balance numeric, email text, currency text, phone text)
language sql security definer set search_path = public
as $$
  select a.id, a.username, a.balance, a.email, a.currency, a.phone
  from customer_sessions s join customer_accounts a on a.id = s.account_id
  where s.token_hash = p_token_hash and s.expires_at > now();
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
as $$ delete from customer_sessions where token_hash = p_token_hash; $$;

create or replace function public.customer_place_bet(p_account_id uuid, p_stake numeric, p_potential_return numeric, p_selections jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare new_bet_id uuid; current_balance numeric;
begin
  select balance into current_balance from customer_accounts where id = p_account_id for update;
  if current_balance is null or current_balance < p_stake then raise exception 'Insufficient balance'; end if;
  insert into customer_bets(account_id, stake, potential_return, selections) values (p_account_id, p_stake, p_potential_return, p_selections) returning id into new_bet_id;
  insert into customer_transactions(account_id, type, amount, status, reference)
  values (p_account_id, 'bet_stake', p_stake, 'completed', 'BET-' || new_bet_id);
  update customer_accounts set balance = balance - p_stake, updated_at = now() where id = p_account_id;
  return jsonb_build_object('id', new_bet_id, 'status', 'open', 'stake', p_stake, 'potential_return', p_potential_return);
end;
$$;

create or replace function public.customer_transaction_history(p_account_id uuid)
returns setof public.customer_transactions
language sql security definer set search_path = public
as $$
  select * from public.customer_transactions
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
