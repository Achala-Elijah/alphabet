import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payments";
import { PaymentError } from "@/lib/payments/types";
import { paymentsClient, settleFromWebhook } from "@/lib/payments/service";

/**
 * Provider webhook endpoint. Point your gateway dashboard here:
 * https://your-domain/api/payments/webhook
 *
 * AlphaPay signs the raw body with HMAC-SHA256 using the webhook signing
 * secret (X-Webhook-Signature / X-Webhook-Timestamp). Paystack uses
 * x-paystack-signature. The active provider verifies the payload before
 * anything is credited.
 *
 * Gateways retry non-2xx responses, so we return 200 `received` for
 * already-settled or unknown-reference events.
 */
export async function POST(request: Request) {
  try {
    const provider = getPaymentProvider();
    const body = await request.text();

    // Extract both signature and timestamp headers.
    // AlphaPay requires X-Webhook-Signature and X-Webhook-Timestamp.
    // Paystack only needs X-Paystack-Signature (or x-signature).
    const alphaSig = request.headers.get("x-webhook-signature");
    const alphaTs = request.headers.get("x-webhook-timestamp");
    const paystackSig = request.headers.get("x-paystack-signature") || request.headers.get("x-signature");

    // Build a "signature|timestamp" string for the generic parseWebhook signature param.
    // If AlphaPay headers are present we use those; otherwise fall back to Paystack.
    let signatureForProvider: string | null = null;
    if (alphaSig && alphaTs) {
      signatureForProvider = `${alphaSig}|${alphaTs}`;
    } else if (paystackSig) {
      signatureForProvider = paystackSig;
    }

    const headers: Record<string, string> = {};
    if (alphaSig) headers["x-webhook-signature"] = alphaSig;
    if (alphaTs) headers["x-webhook-timestamp"] = alphaTs;

    const event = await provider.parseWebhook(body, signatureForProvider, headers);
    const result = await settleFromWebhook(paymentsClient(), event);
    return NextResponse.json({ received: true, status: result.status });
  } catch (reason) {
    if (reason instanceof PaymentError) {
      // Invalid signature, malformed payload, or unknown deposit reference:
      // nothing we should credit; ACK so the gateway doesn't spam retries.
      if (reason.status === 401 || reason.status === 404) {
        return NextResponse.json({ received: true });
      }
      return NextResponse.json({ error: reason.message }, { status: reason.status });
    }
    console.error("Webhook failed:", reason);
    return NextResponse.json({ error: "Webhook could not be processed." }, { status: 500 });
  }
}
