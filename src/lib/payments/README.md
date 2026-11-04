# Payments layer

Gateway-agnostic deposits for **staff wallets** (`profiles.balance`) and
**customer wallets** (`customer_accounts.balance`). No UI or API route knows
which gateway is active — they all talk to this folder.

## Lifecycle

```
POST /api/payments/deposit { amount }
  -> resolve wallet (staff session | customer cookie)
  -> provider.createDeposit()            # manual: instant "paid"; gateway: checkout URL
  -> insert row into public.deposits     # reference, status, provider, checkout_url
  -> if paid: settleDeposit()
       claim status pending -> paid      # idempotent, safe under racing webhooks
       credit wallet balance
       write wallet ledger row           # transactions / customer_transactions
  -> { reference, status, checkoutUrl, balance }

GET  /api/payments/deposit?reference=... # confirm a pending deposit after redirect
POST /api/payments/webhook               # gateway webhook (signature verified)
```

Existing wallet screens keep working unchanged: settlement writes the same
ledger rows the wallets already read.

## Files

| File | Purpose |
| --- | --- |
| `types.ts` | `PaymentProvider` interface + shared types (`PaymentError`) |
| `manual.ts` | Default provider: simulated instant success (no gateway) |
| `paystack.ts` | Paystack scaffold — inactive until configured |
| `index.ts` | Provider registry, selected by `PAYMENT_PROVIDER` |
| `service.ts` | Create / verify / settle / webhook orchestration |

## Going live with Paystack (Ghana + Nigeria)

1. Run `supabase/payments-migration.sql` in the Supabase SQL Editor.
   This creates the `deposits` table used to track every deposit intent.
   `public.customer_session` also needs `phone` returned — re-running
   `supabase/customer-auth-migration.sql` updates that function.
2. Create an account at https://dashboard.paystack.com and grab your keys
   (Settings -> API Keys & Webhooks). The repo comes pre-populated in
   `.env` with test keys; for production replace them with live keys.
3. Add to `.env` and restart Next.js:
   ```
   PAYMENT_PROVIDER=paystack
   PAYSTACK_SECRET_KEY=sk_test_...   # required server-side
   PAYSTACK_PUBLIC_KEY=pk_test_...   # optional — hosted checkout doesn't need it
   ```
4. Set the webhook URL in the Paystack dashboard to
   `https://your-domain/api/payments/webhook`. Paystack sends
   `x-paystack-signature`; the endpoint verifies the HMAC before crediting.
5. Test with a card/MoMo in test mode (min deposit GH₵ 50 / ₦5,000),
   confirm the wallet credits, then swap to the live `sk_live_...` key and
   update the webhook URL to your production domain.

## Callback flow

- `POST /api/payments/deposit` sets `callback_url` to the caller's wallet:
  staff -> `/sub-admin/wallet`, customer -> `/account?nav=wallet`.
- After Paystack checkout, the browser lands back on that page with
  `?reference=DEP-...&trxref=DEP-...`. The page calls
  `verifyAndSettle()` which verifies with Paystack and credits the wallet.
- The webhook (`POST /api/payments/webhook`) is the backup path — if the
  browser never returns, the deposit still settles server-to-server.
  `settleDeposit` is idempotent, so verify and webhook can race safely.

To add a different gateway later: create `yourgateway.ts` implementing
`PaymentProvider`, add it to the `providers` map in `index.ts`, set
`PAYMENT_PROVIDER=yourgateway`.

## Notes

- Amounts are stored in major units (GHS/NGN); providers convert to
  pesewas/kobo themselves.
- The service verifies reported amount/currency against the stored deposit and
  fails the deposit on any mismatch before crediting.
- Withdrawals are unchanged: staff withdraw instantly via `/api/staff/wallet`,
  customer withdrawal stays disabled until a payout method exists.
