export type BetSlipSelection = {
  match: string;
  matchId: string;
  option: string;
  odds: string;
  market: string;
  /**
   * Per-selection stake, used in "Singles" mode — how much is staked on
   * THIS game only. Empty/absent in "Multiple" mode, where the slip-level
   * stake covers the whole accumulator.
   */
  stake?: string;
};

/**
 * "Multiple" = one stake on the whole accumulator (classic bet slip).
 * "Singles"  = every selection gets its own stake and is placed as its
 *              own single bet, exactly how a real sportsbook's slip works.
 */
export type BetSlipMode = "multiple" | "singles";

export type BetSlipState = {
  selections: Record<string, BetSlipSelection>;
  stake: string;
  mode?: BetSlipMode;
};

/**
 * Booking code — a short, human-readable reference that lets anyone reload
 * a bet slip. Format: 5 alphanumeric characters (e.g. X7K2P).
 */
export type BookingCode = string;

export const BET_SLIP_STORAGE_KEY = "alphabet_bet_slip";
const LEGACY_STORAGE_KEY = "betkiing_bet_slip";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

export function generateBookingCode(): BookingCode {
  // 5 chars from the safe alphabet (no 0/O/1/I).
  let code = "";
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
  if (normalized.length !== CODE_LENGTH) return false;
  return normalized.split("").every((ch) => CODE_ALPHABET.includes(ch));
}

/** Human-friendly view of a code (currently just normalized). */
export function formatBookingCode(code: string): string {
  return normalizeBookingCode(code);
}

export function readBetSlip(): BetSlipState {
  if (typeof window === "undefined") return { selections: {}, stake: "150", mode: "multiple" };
  try {
    const raw = window.localStorage.getItem(BET_SLIP_STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
    const stored = JSON.parse(raw || "{}") as Partial<BetSlipState>;
    return {
      selections: stored.selections && typeof stored.selections === "object" ? stored.selections : {},
      stake: typeof stored.stake === "string" ? stored.stake : "150",
      mode: stored.mode === "singles" ? "singles" : "multiple"
    };
  } catch {
    return { selections: {}, stake: "150", mode: "multiple" };
  }
}

export function writeBetSlip(state: BetSlipState) {
  window.localStorage.setItem(BET_SLIP_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Serialize a bet slip for sharing. Selections are stored by their stable
 * key (matchId + market + option) and stake. The code itself is stored in
 * the database by the API — this helper only builds the payload.
 *
 * Per-selection stakes ride along inside each selection, so a shared
 * "Singles" slip keeps every game's own stake when it is loaded elsewhere.
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
  // A slip whose selections each carry their own stake was shared from
  // Singles mode — restore that mode instead of dumping them in a
  // accumulator with a single stake box.
  const values = Object.values(selections);
  const isSingles = values.length > 0 && values.every((sel) => Number(sel.stake) > 0);
  return {
    selections,
    stake: typeof payload.stake === "string" ? payload.stake : "150",
    mode: isSingles ? "singles" : "multiple"
  };
}
