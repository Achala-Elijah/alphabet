/**
 * Homepage featured cards — overwritten at runtime by /api/sports/live
 * `?featured=true`, which uses the same deterministic odds engine as the
 * live list (`generateFeaturedOdds` in sports-data.ts). These rows are only
 * a placeholder while the API loads; they are not the live odds.
 */
export const featuredMatches = [
  { league: "Italy · Serie C", home: "Qingdao Red Lions", away: "Dalian Kew", homeCode: "QR", awayCode: "DK", time: "1:00 PM", odds: ["2.36", "2.85", "2.33"], tag: "BEST ODDS" },
  { league: "Germany · 2. Bundesliga", home: "Erzurumspor", away: "Karagumruk", homeCode: "ER", awayCode: "KG", time: "2:30 PM", odds: ["2.10", "3.15", "3.20"], tag: "HOT 🔥" },
  { league: "England · Championship", home: "Bristol City", away: "Norwich", homeCode: "BC", awayCode: "NC", time: "4:00 PM", odds: ["2.45", "3.05", "2.70"], tag: "BEST ODDS" }
];

/**
 * Live matches come from SportScore via /api/sports/live — this mock list is
 * kept only as a last-resort fallback for the homepage when the API is down.
 * All entries are SportScore-sourced.
 */
export const liveMatches = [];

/**
 * Mock admin stats — the real dashboard in /sub-admin computes stats live
 * from Supabase (customer_accounts, customer_bets, customer_transactions,
 * matches, withdrawal_requests). This constant is kept only for any legacy
 * import; it does not drive the UI.
 */
export const adminStats: Array<{ label: string; value: string; change: string; icon: string }> = [];

export const transactions = [
  { id: "TXN-008421", user: "Kwame A.", type: "Deposit", amount: "GH₵ 250.00", status: "Completed", date: "02 Nov 2026, 10:42" },
  { id: "TXN-008420", user: "Ama K.", type: "Withdrawal", amount: "GH₵ 120.00", status: "Pending", date: "02 Nov 2026, 10:18" },
  { id: "TXN-008419", user: "Kofi B.", type: "Deposit", amount: "GH₵ 500.00", status: "Completed", date: "02 Nov 2026, 09:56" },
  { id: "TXN-008418", user: "Abena D.", type: "Withdrawal", amount: "GH₵ 75.00", status: "Failed", date: "02 Nov 2026, 09:21" }
];

export const users = [
  { name: "Kwame Asare", email: "kwame@example.com", phone: "+233 24 000 0001", bets: 48, balance: "GH₵ 340.00", status: "Active" },
  { name: "Ama Kusi", email: "ama@example.com", phone: "+233 55 000 0002", bets: 26, balance: "GH₵ 85.50", status: "Active" },
  { name: "Kofi Boateng", email: "kofi@example.com", phone: "+233 20 000 0003", bets: 12, balance: "GH₵ 0.00", status: "Suspended" },
  { name: "Abena Danso", email: "abena@example.com", phone: "+233 27 000 0004", bets: 31, balance: "GH₵ 210.00", status: "Active" }
];
