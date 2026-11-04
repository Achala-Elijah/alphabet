-- Bet settlement support.
--
-- 1. customer_bets.settled_at — records when a bet was decided (staff `bets`
--    already has this column).
-- 2. public.place_bet() — the staff wallet function from supabase/schema.sql
--    that is missing in this project; without it staff cannot place bets at all
--    ("The bet could not be placed").
--
-- Safe to run multiple times.

alter table public.customer_bets add column if not exists settled_at timestamptz;

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

grant execute on function public.place_bet(numeric, numeric, jsonb) to authenticated;
