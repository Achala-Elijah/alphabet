export type BetSlipSelection = {
  match: string;
  matchId: string;
  option: string;
  odds: string;
  market: string;
};

export type BetSlipState = {
  selections: Record<string, BetSlipSelection>;
  stake: string;
};

/**
 * Booking code — a short, human-readable reference that lets anyone reload
 * a bet slip. Format: AB + 6 chars from a safe alphabet (no 0/O/1/I to
 * avoid transcription errors). Example: ABX7K2P
 */
export type BookingCode = string;

export const BET_SLIP_STORAGE_KEY = "alphabet_bet_slip";
const LEGACY_STORAGE_KEY = "betkiing_bet_slip";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export function generateBookingCode(): BookingCode {
  // AB + 6 chars from the safe alphabet (no 0/O/1/I).
  let code = "AB";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeBookingCode(input: string): BookingCode {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function isValidBookingCode(input: string): boolean {
  const normalized = normalizeBookingCode(input);
  if (!normalized.startsWith("AB") || normalized.length !== "AB".length + CODE_LENGTH) return false;
  const body = normalized.slice(2);
  return body.split("").every((ch) => CODE_ALPHABET.includes(ch));
}

/**
 * Human-friendly view of a code: ABX7K2P → "AB X7K2P" (prefix + body).
 * Used in the boxed-input UI (8 boxes, gap after the "AB" prefix).
 */
export function formatBookingCode(code: string): string {
  const normalized = normalizeBookingCode(code);
  if (normalized.length <= 2) return normalized;
  return `${normalized.slice(0, 2)} ${normalized.slice(2)}`;
}

export function readBetSlip(): BetSlipState {
  if (typeof window === "undefined") return { selections: {}, stake: "150" };
  try {
    const raw = window.localStorage.getItem(BET_SLIP_STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
    const stored = JSON.parse(raw || "{}") as Partial<BetSlipState>;
    return {
      selections: stored.selections && typeof stored.selections === "object" ? stored.selections : {},
      stake: typeof stored.stake === "string" ? stored.stake : "150"
    };
  } catch {
    return { selections: {}, stake: "150" };
  }
}

export function writeBetSlip(state: BetSlipState) {
  window.localStorage.setItem(BET_SLIP_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Serialize a bet slip for sharing. Selections are stored by their stable
 * key (matchId + market + option) and stake. The code itself is stored in
 * the database by the API — this helper only builds the payload.
 */
export function serializeBetSlipForCode(state: BetSlipState): { selections: BetSlipSelection[]; stake: string } {
  return {
    selections: Object.values(state.selections),
    stake: state.stake
  };
}

export function deserializeBetSlipFromCode(payload: { selections: BetSlipSelection[]; stake?: string }): BetSlipState {
  const selections: Record<string, BetSlipSelection> = {};
  for (const sel of payload.selections) {
    const key = `${sel.matchId}|${sel.market}|${sel.option}`;
    selections[key] = sel;
  }
  return {
    selections,
    stake: typeof payload.stake === "string" ? payload.stake : "150"
  };
}
