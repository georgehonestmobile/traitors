const tz = () => process.env.APP_TIMEZONE || "Europe/London";

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz(),
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function relative(iso: string, now = Date.now()) {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const text =
    mins < 1 ? "less than a minute" : mins < 60 ? `${mins} min` : mins < 60 * 48 ? `${Math.round(mins / 60)} hr` : `${Math.round(mins / 1440)} days`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}
