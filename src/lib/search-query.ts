/**
 * Keeps the header input and the home-page results in sync.
 *
 * The URL's `q` parameter is the source of truth, but the header also listens
 * to this event so clearing/opening a result updates the visible input without
 * a full navigation round-trip.
 */
export const SEARCH_UPDATED_EVENT = "alphabet:search-updated";

export function readSearchQuery() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") || "";
}

export function writeSearchQuery(value: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(SEARCH_UPDATED_EVENT, { detail: value }));
}
