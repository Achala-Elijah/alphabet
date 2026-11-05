/**
 * Fuzzy match scorer used by the home-page search.
 *
 * It intentionally stays dependency-free: exact and prefix matches rank
 * highest, then substring matches, then small typos (Levenshtein distance),
 * and finally abbreviations such as "utd" for "United".
 */

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Bounded Levenshtein distance — stops early once it exceeds `cap`. */
function distance(a: string, b: string, cap: number) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > cap) return cap + 1;
    previous = current;
  }
  return previous[b.length];
}

function isSubsequence(needle: string, haystack: string) {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

function typoDistanceFor(length: number) {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  return 2;
}

/** How well one query word matches one fixture word. 0 means no match. */
function wordScore(word: string, term: string) {
  if (word === term) return 120;
  if (word.startsWith(term)) return 100 - Math.min(word.length - term.length, 30);
  if (word.includes(term)) return 80 - Math.min(word.indexOf(term), 30);
  if (term.length >= 4) {
    const allowed = typoDistanceFor(term.length);
    if (allowed > 0) {
      const gap = distance(word, term, allowed);
      if (gap <= allowed) return 55 - gap * 10;
    }
  }
  // Abbreviation/short-code fallback: "utd" inside "united".
  if (term.length >= 2 && isSubsequence(term, word)) return 26;
  return 0;
}

/** Returns a positive score when `haystack` matches `query`, otherwise -1. */
export function fuzzyScore(haystack: string, query: string): number {
  const text = normalize(haystack);
  const term = normalize(query);
  if (!term) return 1;
  if (!text) return -1;

  const exact = text.indexOf(term);
  if (exact >= 0) {
    const wholeWord = new RegExp(`(^| )${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(text);
    return 200 - Math.min(exact, 60) + (wholeWord ? 40 : 0);
  }

  const words = text.split(" ");
  const terms = term.split(" ");
  let score = 0;
  for (const piece of terms) {
    let best = 0;
    for (const word of words) {
      best = Math.max(best, wordScore(word, piece));
      if (best >= 120) break;
    }
    if (best === 0 && isSubsequence(piece, text)) best = 24;
    if (best === 0) return -1;
    score += best;
  }
  return score;
}
