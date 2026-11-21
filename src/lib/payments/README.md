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
| `alphapay.ts` | **Active** AlphaPay hosted checkout (Ghana + Nigeria) |
| `paystack.ts` | Kept for future use — inactive while the account is under review |
| `index.ts` | Provider registry, active-provider helpers and currency routing |
| `service.ts` | Create / verify / settle / webhook orchestration |

## Currency routing

Routing is decided on the server from the wallet currency and the active
provider — no country column is needed (`GHS` = Ghana, `NGN` = Nigeria).

| `PAYMENT_PROVIDER` | GHS wallet | NGN wallet |
| --- | --- | --- |
| `alphapay` | AlphaPay checkout (`country=GH`) | AlphaPay checkout (`country=NG`, bank transfer / virtual account) |
| `paystack` | Paystack checkout | OPay screenshot upload + admin approval |
| `manual` | Simulated instant deposit | OPay screenshot upload + admin approval |

> **AlphaPay NGN route and fee:** this merchant currently has only `allbanks_ng`
> ("Nigeria – Tous les réseaux bancaires") enabled for payin. `mtn_ng` and
> `airtel_ng` are in AlphaPay's catalogue but are not routed for this account,
> so hosted checkout does not offer them. The live rate is **3% `ADD_ON`** —
> a ₦20,000 deposit displays ₦600 extra, the customer pays ₦20,600, and the
> customer wallet is credited ₦20,000. That fee is AlphaPay's, not ours; we
> send the selected amount unchanged.

The same rule applies to the withdrawal activation fee. The OPay upload UI is
only shown when the active provider is **not** AlphaPay; the gateway routes
also reject direct NGN requests in that case so the flow cannot be bypassed.
AlphaPay NGN deposits go through the normal `deposits` table, verification and
referral-commission flow.

## Going live with AlphaPay (Ghana + Nigeria)

1. Run `supabase/payments-migration.sql` in the Supabase SQL Editor.
   This creates the `deposits` table used to track every deposit intent.
2. Create an account at https://app.alphapay.me, complete KYC, and generate an
   API key. That single key is all hosted checkout needs — AlphaPay does not
   issue a separate public key for this flow.
3. Add to `.env` and restart Next.js:
   ```
   PAYMENT_PROVIDER=alphapay
   ALPHAPAY_SECRET_KEY=sk_live_...     # sk_test_... auto-selects the sandbox
   ALPHAPAY_WEBHOOK_SECRET=...         # optional; see step 4
   ALPHAPAY_SANDBOX=false              # set true to force sandbox
   ```
4. In the AlphaPay dashboard create a webhook pointing to
   `https://your-domain/api/payments/webhook` and subscribe it to
   `transaction.success`, `transaction.failed` and `transaction.cancelled`.
   The dashboard shows a **signing secret** once when the webhook is created —
   copy it into `ALPHAPAY_WEBHOOK_SECRET` so the endpoint can verify
   `X-Webhook-Signature` / `X-Webhook-Timestamp` (HMAC-SHA256 of
   `${timestamp}.${rawBody}`). If you did not copy it, leave the variable blank:
   webhooks are then re-verified directly against AlphaPay's API before any
   wallet is credited, and the browser return path still settles deposits.
5. Test a small deposit (min GH₵ 50 / ₦5,000), confirm the wallet credits, and
   verify the webhook delivery log in the AlphaPay dashboard.

## Switching back to Paystack later

Set `PAYMENT_PROVIDER=paystack`, restore `PAYSTACK_SECRET_KEY` and
`PAYSTACK_PUBLIC_KEY`, and point the Paystack webhook at
`https://your-domain/api/payments/webhook`. Paystack will be used for GHS
wallets only; NGN wallets automatically return to the OPay screenshot upload.
No other code changes are needed.

## Callback flow

- `POST /api/payments/deposit` sets `return_url` to the caller's wallet:
  staff -> `/sub-admin/wallet`, customer -> `/account?nav=wallet`, with our
  `?reference=DEP-...` appended.
- After AlphaPay checkout the browser returns to that page, which calls
  `verifyAndSettle()` — this queries the AlphaPay checkout session and credits
  the wallet only when the session status is `PAID`.
- The webhook (`POST /api/payments/webhook`) is the backup path — if the
  browser never returns, the deposit still settles server-to-server. Our
  internal `DEP-...` reference is sent in the checkout session `metadata` and
  description so AlphaPay's `TXN-...` webhook reference can be mapped back.
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
