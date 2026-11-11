/** Timezone helpers (no dependencies). Dates as "YYYY-MM-DD" are calendar days. */

export const appTimeZone = () => process.env.APP_TIMEZONE || "Europe/London";

/** Milliseconds the zone is ahead of UTC at the given instant. */
function offsetMs(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at.getTime();
}

/** The instant a wall-clock time happens in a zone, e.g. 09:00 on 2026-12-07 in London. */
export function zonedTime(ymd: string, hour: number, minute: number, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - offsetMs(new Date(t), timeZone);
  return new Date(t);
}

/** The calendar day of an instant in a zone. */
export function ymdIn(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
