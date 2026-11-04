import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payments";
import { PaymentError } from "@/lib/payments/types";
import { paymentsClient, settleFromWebhook } from "@/lib/payments/service";

/**
 * Provider webhook endpoint. Point your gateway dashboard here, e.g. Paystack:
 * Settings -> Webhooks -> https://your-domain/api/payments/webhook
 * The provider implementation authenticates the payload (Paystack: HMAC
 * x-paystack-signature) before anything is credited.
 *
 * Paystack retries non-2xx responses, so we return 200 `received` even for
 * already-settled or unknown-reference events — only signature failures and
 * true server errors bubble up so Paystack keeps retrying.
 */
export async function POST(request: Request) {
  try {
    const provider = getPaymentProvider();
    const body = await request.text();
    const signature = request.headers.get("x-paystack-signature") || request.headers.get("x-signature");
    const event = await provider.parseWebhook(body, signature);
    const result = await settleFromWebhook(paymentsClient(), event);
    return NextResponse.json({ received: true, status: result.status });
  } catch (reason) {
    if (reason instanceof PaymentError) {
      // Invalid signature, malformed payload, or unknown deposit reference:
      // nothing we should credit; log and ACK so Paystack doesn't spam retries.
      if (reason.status === 401 || reason.status === 404) {
        return NextResponse.json({ received: true });
      }
      return NextResponse.json({ error: reason.message }, { status: reason.status });
    }
    console.error("Webhook failed:", reason);
    return NextResponse.json({ error: "Webhook could not be processed." }, { status: 500 });
  }
}
