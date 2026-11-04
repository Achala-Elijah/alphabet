-- Fix: customer_transaction_history() is missing in some projects even though
-- every other function from customer-auth-migration.sql exists.
-- Without it the customer wallet shows "No transactions yet" and
-- GET /api/wallet returns 500. Safe to run multiple times.

create or replace function public.customer_transaction_history(p_account_id uuid)
returns setof public.customer_transactions
language sql security definer set search_path = public
as $$
  select *
  from public.customer_transactions
  where account_id = p_account_id
  order by created_at desc;
$$;

grant execute on function public.customer_transaction_history(uuid) to anon, authenticated;
