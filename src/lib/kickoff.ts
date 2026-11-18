/**
 * SportyBet-style kickoff labels. Uses relative day names for nearby
 * fixtures and a compact weekday/date for the rest of the year.
 */
export function formatKickoff(value?: string) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDifference = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);

  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  if (dayDifference === 0) return `Today · ${time}`;
  if (dayDifference === 1) return `Tomorrow · ${time}`;
  if (dayDifference === -1) return `Yesterday · ${time}`;

  const sameYear = date.getFullYear() === now.getFullYear();
  const dateLabel = date.toLocaleDateString([], sameYear
    ? { weekday: "short", day: "numeric", month: "short" }
    : { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return `${dateLabel} · ${time}`;
}
