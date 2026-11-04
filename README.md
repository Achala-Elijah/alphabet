# BETKIING UI — Next.js starter

A frontend-only recreation of the supplied BETKIING mobile screenshots, with a client betting homepage, account menu, and a sub-admin dashboard shell.

## Requirements
- Node.js 20.9+ (Node 20 LTS recommended)
- npm

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Admin sub-admin creation and listing require the Supabase project's server-only `SUPABASE_SERVICE_ROLE_KEY` in `.env`. Get it from Supabase Project Settings > API. Never expose this key with a `NEXT_PUBLIC_*` name or commit it.

Referral ownership requires running `supabase/referrals-migration.sql` in the Supabase SQL Editor after the customer auth migration. It adds a unique referral code to each sub-admin and assigns new customer signups from `/register?ref=...` to that sub-admin. Sub-admin data access is then limited by database policies to their referred customers.

## Pages included
- `/` — client homepage: sports shortcuts, promo tiles, featured matches, odds, live match list.
- `/account` — account menu based on the supplied screenshot.
- `/sub-admin` — sub-admin dashboard overview.
- `/sub-admin/matches` — match management table.
- `/sub-admin/users` — user management table.
- `/sub-admin/transactions` — transaction table.
- `/sub-admin/partners` — partner analytics.
- `/sub-admin/settings` — UI settings page.

## UI scope
This version is intentionally frontend-only. Tables, filters, tabs, mobile navigation, and sidebar links use local mock data and client-side interactions. There is no authentication, database, payment processing, live odds feed, or API integration yet.

## Project structure

```text
src/
  app/
    account/
    sub-admin/
      matches/
      users/
      transactions/
      partners/
      settings/
    globals.css
    layout.tsx
    page.tsx
  components/
    admin-shell.tsx
    client-header.tsx
    client-bottom-nav.tsx
    match-card.tsx
    section-title.tsx
  lib/
    mock-data.ts
```

## Next development step
Once the reference admin screens are available, replace the dashboard placeholders and tune each admin page to match the original. Then we can add Next.js Route Handlers, authentication, database models, and real integrations without rewriting the UI.

## SportScore live football feed

The homepage now loads live and recent football matches from SportScore through the Next.js route `GET /api/sports/live`. The browser polls that route every 60 seconds; the server-side fetch is also cached for 60 seconds. No API key is required for the public endpoint.

SportScore's free developer tier requires a visible dofollow attribution link, which is included below the scores. The public developer page describes the free tier as approximately 10,000 requests per 24 hours per IP and asks commercial/high-volume products to contact SportScore. **Important:** SportScore's general website terms restrict commercial use of its site data. Before using this feed on a real-money betting product, obtain written permission/licensing from SportScore. This integration is for development/prototyping and displays scores only; it does not provide betting odds or settlement-grade data.

The homepage's pre-existing featured odds cards remain mock UI data and are not supplied by SportScore. Do not use those sample prices to accept bets.
