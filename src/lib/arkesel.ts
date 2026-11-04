/**
 * Arkesel SMS & OTP Client for Ghana (+233)
 * Official API documentation: https://developers.arkesel.com
 */

const ARKESEL_BASE_URL = "https://sms.arkesel.com/api/v2";

export type SendSmsOptions = {
  recipients: string | string[];
  message: string;
  sender?: string;
};

export type ArkeselResponse = {
  success: boolean;
  error?: string;
  data?: unknown;
};

/**
 * Format a phone number into the required international Ghana format (e.g., 233240000000).
 */
export function formatGhanaPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    return `233${digits.slice(1)}`;
  }
  if (digits.startsWith("233")) {
    return digits;
  }
  return digits;
}

/**
 * Send an SMS message via Arkesel v2 API.
 */
export async function sendArkeselSms({ recipients, message, sender }: SendSmsOptions): Promise<ArkeselResponse> {
  const apiKey = process.env.ARKESEL_API_KEY;
  if (!apiKey) {
    console.warn("ARKESEL_API_KEY is not set. SMS was skipped.");
    return { success: false, error: "ARKESEL_API_KEY is not configured in .env." };
  }

  const senderId = sender || process.env.ARKESEL_SENDER_ID || "AlphaBet";
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const formattedRecipients = list.map(formatGhanaPhoneNumber).filter(Boolean);

  if (formattedRecipients.length === 0) {
    return { success: false, error: "No valid recipient phone numbers provided." };
  }

  try {
    const response = await fetch(`${ARKESEL_BASE_URL}/sms/send`, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: senderId,
        message,
        recipients: formattedRecipients
      })
    });

    const result = (await response.json().catch(() => null)) as { status?: string; message?: string; data?: unknown } | null;

    if (!response.ok || (result && result.status !== "success")) {
      const errorMsg = result?.message || `Arkesel request failed with status ${response.status}`;
      console.error("Arkesel SMS error:", errorMsg);
      return { success: false, error: errorMsg, data: result };
    }

    return { success: true, data: result?.data };
  } catch (error) {
    console.error("Failed to connect to Arkesel API:", error);
    return { success: false, error: error instanceof Error ? error.message : "Connection error" };
  }
}
