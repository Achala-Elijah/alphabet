-- Booking codes: shareable references to bet slips.
-- Run this once in the Supabase SQL Editor.
--
-- Flow:
--   1. User clicks "Share" on the bet slip -> POST /api/booking-codes
--      generates a code (e.g. ABX7K2P) and saves the selections + stake.
--   2. User shares the code with friends.
--   3. Friend opens the site, clicks "Load Code", enters the code ->
--      GET /api/booking-codes?code=ABX7K2P returns the selections.
--   4. The bet slip is restored in their browser — they can place the bet
--      with their own stake.

create table if not exists public.booking_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  selections jsonb not null,
  stake numeric(12,2) not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists booking_codes_code_idx on public.booking_codes (code);
create index if not exists booking_codes_expires_idx on public.booking_codes (expires_at);
create index if not exists booking_codes_created_by_idx on public.booking_codes (created_by);

alter table public.booking_codes enable row level security;

-- Everyone can read a valid booking code (it's a shared reference).
-- Writes happen server-side via /api/booking-codes with the service key.
drop policy if exists "Anyone can read booking codes" on public.booking_codes;
create policy "Anyone can read booking codes"
  on public.booking_codes for select using (expires_at > now());
