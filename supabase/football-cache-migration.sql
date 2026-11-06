-- Shared, database-backed cache for API-Football responses.
-- Run this once in the Supabase SQL Editor.
--
-- Read-through TTL cache used by src/lib/api-football.ts:
--   1. Request arrives -> read the row for the key.
--   2. Row is fresh (expires_at in the future)  -> serve it. No API call.
--   3. Row is expired or missing                -> consume one unit of the
--      shared daily quota, call API-Football, then rewrite the row with a
--      new expiry. The TTL restarts only when someone asks after it lapsed
--      (lazy invalidation on read).
--   4. Provider error                           -> serve the expired row
--      (stale beats empty).
--
-- No RLS policies on purpose: only the service role reads or writes this
-- table, exactly like the quota guard.

create table if not exists public.football_api_cache (
  key text primary key,
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists football_api_cache_expires_at_idx
  on public.football_api_cache (expires_at);

alter table public.football_api_cache enable row level security;
