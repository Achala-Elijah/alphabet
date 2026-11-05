-- Currency switch migration: Ghana cedis ↔ naira at the app's fixed rate.
-- Run once in the Supabase SQL Editor.
--
-- Current code has one wallet per customer, stored in the customer's chosen
-- currency. Without this migration, switching between GHS and NGN only changes
-- the label — a GH₵ 100 balance would become an ₦100 balance.
-- The fix is a full conversion of the customer's own money ledger:
--   balance, past bets (stake / potential return / per-selection stake),
--   wallet history, pending withdrawals and the customer's stored booking codes.
--
-- Deposit records, gateway charges and staff commissions are NOT converted:
-- those amounts represent money paid at a point in time in the currency it
-- was paid in.

create or replace function public.customer_update_profile(p_account_id uuid, p_currency text, p_email text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_old_currency text;
  v_factor numeric(18,6);
begin
  if p_currency not in ('GHS', 'NGN') then
    raise exception 'Unsupported currency';
  end if;

  select currency
  into v_old_currency
  from public.customer_accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'Account not found';
  end if;

  if v_old_currency = p_currency then
    update public.customer_accounts
    set email = nullif(trim(p_email), ''), updated_at = now()
    where id = p_account_id;
    return;
  end if;

  -- 1 GHS = 100 NGN (see src/lib/limits.ts → GHS_TO_NGN).
  v_factor := case when v_old_currency = 'GHS' then 100 when v_old_currency = 'NGN' then 0.01 else null end;
  if v_factor is null then
    raise exception 'Unsupported account currency %', v_old_currency;
  end if;

  update public.customer_accounts
  set currency = p_currency,
      balance = round(balance * v_factor, 2),
      email = nullif(trim(p_email), ''),
      updated_at = now()
  where id = p_account_id;

  -- Customer-owned ledger: all of it must scale together, or the wallet
  -- balance no longer matches the transaction/bet history.
  update public.customer_bets
  set stake = round(stake * v_factor, 2),
      potential_return = round(potential_return * v_factor, 2),
      selections = coalesce((
        select jsonb_agg(
          case
            when elem ? 'stake' then
              elem || jsonb_build_object('stake', round((elem->>'stake')::numeric * v_factor, 2))
            else elem
          end
        )
        from jsonb_array_elements(coalesce(selections, '[]'::jsonb)) as elem
      ), '[]'::jsonb)
  where account_id = p_account_id;

  update public.customer_transactions
  set amount = round(amount * v_factor, 2)
  where account_id = p_account_id;

  if to_regclass('public.withdrawal_requests') is not null then
    update public.withdrawal_requests
    set amount = round(amount * v_factor, 2),
        currency = p_currency,
        updated_at = now()
    where account_id = p_account_id;
  end if;

  -- Stored slips the customer themselves created keep the same Ghana-cedi
  -- value, so an old code preloads the equivalent amount in the new currency.
  if to_regclass('public.booking_codes') is not null then
    update public.booking_codes
    set stake = round(stake * v_factor, 2),
        selections = coalesce((
          select jsonb_agg(
            case
              when elem ? 'stake' then
                elem || jsonb_build_object('stake', round((elem->>'stake')::numeric * v_factor, 2))
              else elem
            end
          )
          from jsonb_array_elements(coalesce(selections, '[]'::jsonb)) as elem
        ), '[]'::jsonb)
    where created_by = p_account_id;
  end if;
end;
$$;
