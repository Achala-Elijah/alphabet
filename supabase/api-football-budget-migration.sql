-- Hard API-Football quota guard. Run once in the Supabase SQL Editor.
--
-- The app previously relied on Next's Data Cache plus an in-process counter.
-- Those are not guaranteed across deploys or concurrent instances, so they
-- cannot enforce a shared 100/day quota. This migration adds a single atomic
-- counter shared by every server request.
--
-- Calls are rejected once the shared counter reaches its limit.

create table if not exists public.api_football_budget (
  day date primary key,
  calls integer not null default 0 check (calls >= 0),
  updated_at timestamptz not null default now()
);

alter table public.api_football_budget enable row level security;

-- No public policies are required — only the service role can call this function.
create or replace function public.consume_football_api(p_day date, p_limit integer)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  insert into public.api_football_budget (day, calls, updated_at)
  values (p_day, 1, now())
  on conflict (day) do update
    set calls = public.api_football_budget.calls + 1,
        updated_at = now()
    where public.api_football_budget.calls < p_limit;
  return found;
end;
$$;

revoke all on function public.consume_football_api(date, integer) from public;
grant execute on function public.consume_football_api(date, integer) to service_role;
