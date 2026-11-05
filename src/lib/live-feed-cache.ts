import type { SportsMatch } from "@/lib/sports-data";

/**
 * Last-seen copy of the live feed, shared by the feed route and settlement.
 *
 * SportScore stops returning a fixture shortly after full time. Settlement
 * still needs its final score to decide a bet that was placed on it, so every
 * feed response refreshes this cache and settlement reads it back.
 */
export type CachedFixture = {
  id: string;
  status: string;
  kickoff: string;
  current_minute: number | null;
  home_score: number | null;
  away_score: number | null;
};

type CacheGlobal = typeof globalThis & { __alphabetLiveFeedCache?: Map<string, CachedFixture> };

function store(): Map<string, CachedFixture> {
  const globalStore = globalThis as CacheGlobal;
  if (!globalStore.__alphabetLiveFeedCache) globalStore.__alphabetLiveFeedCache = new Map();
  return globalStore.__alphabetLiveFeedCache;
}

export function rememberFixtures(matches: SportsMatch[]) {
  const cache = store();
  const now = Date.now();
  for (const match of matches) {
    if (!match.slug) continue;
    // Keep the fixture around for a day; older entries are pruned below.
    cache.set(match.slug, {
      id: match.slug,
      status: match.status || "scheduled",
      kickoff: match.time || new Date(now).toISOString(),
      current_minute: typeof match.current_minute === "number" ? match.current_minute : null,
      home_score: typeof match.home_score === "number" ? match.home_score : null,
      away_score: typeof match.away_score === "number" ? match.away_score : null
    });
  }
  if (cache.size > 600) {
    const cutoff = now - 24 * 60 * 60 * 1000;
    for (const [id, fixture] of cache) {
      if (new Date(fixture.kickoff).getTime() < cutoff) cache.delete(id);
    }
  }
}

export function cachedFixtures(ids: string[]): CachedFixture[] {
  const cache = store();
  const out: CachedFixture[] = [];
  for (const id of ids) {
    const fixture = cache.get(id);
    if (fixture) out.push(fixture);
  }
  return out;
}
