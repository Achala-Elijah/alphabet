-- Run this after schema.sql and customer-auth-migration.sql.
-- Referral ownership is assigned only during customer registration.

alter table public.profiles add column if not exists referral_code text;
create unique index if not exists profiles_referral_code_idx on public.profiles(referral_code) where referral_code is not null;
update public.profiles
set referral_code = encode(gen_random_bytes(6), 'hex')
where role = 'sub_admin' and referral_code is null;

alter table public.customer_accounts add column if not exists referred_by uuid references public.profiles(id);
create index if not exists customer_accounts_referred_by_idx on public.customer_accounts(referred_by);

create or replace function public.customer_register(
  p_username text,
  p_phone text,
  p_password text,
  p_referral_code text default null
)
returns uuid
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  new_id uuid;
  referrer_id uuid;
begin
  if length(trim(p_username)) < 3 or length(trim(p_phone)) < 7 or length(p_password) < 6 then
    raise exception 'Username, phone, and password are invalid';
  end if;
  if exists (select 1 from public.customer_accounts where username = lower(trim(p_username)) or phone = trim(p_phone)) then
    raise exception 'An account with that username or phone already exists';
  end if;
  if nullif(trim(p_referral_code), '') is not null then
    select id into referrer_id from public.profiles
    where referral_code = trim(p_referral_code) and role = 'sub_admin';
    if referrer_id is null then raise exception 'This referral link is invalid or expired'; end if;
  end if;
  insert into public.customer_accounts(username, phone, password_hash, referred_by)
  values (lower(trim(p_username)), trim(p_phone), extensions.crypt(p_password, extensions.gen_salt('bf')), referrer_id)
  returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.customer_register(text, text, text, text) to anon, authenticated;

drop policy if exists "Staff can view customer accounts" on public.customer_accounts;
create policy "Staff can view customer accounts"
  on public.customer_accounts for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or referred_by = auth.uid()
  );

drop policy if exists "Staff can view customer bets" on public.customer_bets;
create policy "Staff can view customer bets"
  on public.customer_bets for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (select 1 from public.customer_accounts a where a.id = account_id and a.referred_by = auth.uid())
  );

drop policy if exists "Staff can view customer transactions" on public.customer_transactions;
create policy "Staff can view customer transactions"
  on public.customer_transactions for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (select 1 from public.customer_accounts a where a.id = account_id and a.referred_by = auth.uid())
  );

drop policy if exists "Admins can manage matches" on public.matches;
create policy "Admins can manage matches"
  on public.matches for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Staff can delete matches" on public.matches;
create policy "Staff can delete matches"
  on public.matches for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
