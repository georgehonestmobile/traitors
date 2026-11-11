/**
 * The game's planned schedule of murders and banishments, and how the game is tracking
 * against it. Pure functions: shared by the server and the admin page.
 */

export type ScheduleKind = "murder" | "banishment" | "end";

export type ScheduleItem = {
  id: string;
  /** "YYYY-MM-DD" (a calendar day, no timezone). */
  date: string;
  kind: ScheduleKind;
  /** e.g. the Traitors recruited instead of murdering: nobody left the game. */
  skipped?: boolean;
};

/** Who actually left, in order. */
export type Departure = { playerId: string; name: string; how: "banished" | "murdered"; at: string };

export type ScheduleRow = ScheduleItem & {
  weekday: string;
  /** Planned players remaining before and after this event. */
  before: number;
  after: number;
  status: "done" | "skipped" | "today" | "overdue" | "upcoming";
  actual?: Departure;
  /** The actual departure was a different kind of event to the one planned. */
  mismatch: boolean;
};

export type ScheduleSummary = {
  rows: ScheduleRow[];
  next?: ScheduleRow;
  plannedEnd?: number;
  endDate?: string;
  /** Departures beyond the schedule. */
  extra: number;
  /** Events on or before today that haven't happened yet. */
  overdue: number;
  skipped: number;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const dayOfWeek = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const weekdayName = (date: string) => WEEKDAYS[dayOfWeek(date)];

export function formatDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Today's date ("YYYY-MM-DD") in the given timezone. */
export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Order by date, keeping the given order for events on the same day. */
export function sortSchedule(items: ScheduleItem[]) {
  return items.map((it, i) => ({ it, i })).sort((a, b) => a.it.date.localeCompare(b.it.date) || a.i - b.i).map((x) => x.it);
}

export function summarize(items: ScheduleItem[], plannedStart: number, departures: Departure[], today: string): ScheduleSummary {
  const outs = [...departures].sort((a, b) => a.at.localeCompare(b.at));
  let remaining = plannedStart;
  let k = 0;
  let overdue = 0;
  let skipped = 0;
  const rows: ScheduleRow[] = sortSchedule(items).map((it) => {
    const base = { ...it, weekday: weekdayName(it.date), mismatch: false };
    const timing = it.date < today ? "overdue" : it.date === today ? "today" : "upcoming";
    if (it.kind === "end") return { ...base, before: remaining, after: remaining, status: timing === "overdue" ? "done" : timing };
    if (it.skipped) {
      skipped++;
      return { ...base, before: remaining, after: remaining, status: "skipped" };
    }
    const actual = outs[k++];
    const row: ScheduleRow = {
      ...base,
      before: remaining,
      after: remaining - 1,
      status: actual ? "done" : timing,
      actual,
      mismatch: !!actual && (actual.how === "banished") !== (it.kind === "banishment"),
    };
    if (!actual && timing === "overdue") overdue++;
    remaining--;
    return row;
  });
  const end = rows.find((r) => r.kind === "end");
  return {
    rows,
    next: rows.find((r) => r.status === "today" || r.status === "upcoming"),
    plannedEnd: end?.before ?? (rows.length ? remaining : undefined),
    endDate: end?.date,
    extra: Math.max(0, outs.length - k),
    overdue,
    skipped,
  };
}

/**
 * Read a schedule pasted from a spreadsheet (one event per line), e.g.
 *   "Wednesday	9th December	Banishment	6	5"
 * Dates without a year are placed on or after `from`. Returns the events in date
 * order and, if given, the number remaining at the start of the first event.
 */
export function parseSchedule(text: string, from: string): { items: Omit<ScheduleItem, "id">[]; plannedStart?: number } {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const rows: { date: string; kind: ScheduleKind; start?: number; line: number }[] = [];
  text.split(/\r?\n/).forEach((line, lineNo) => {
    const m = line.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
    const iso = line.match(/(\d{4})-(\d{2})-(\d{2})/);
    const kindMatch = line.match(/end\s*game|banish|murder/i);
    if (!kindMatch || (!m && !iso)) return;
    let y: number, mo: number, d: number;
    if (iso) {
      [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    } else {
      const monthIdx = MONTHS.findIndex((name) => name.startsWith(m![2].toLowerCase().slice(0, 3)));
      if (monthIdx < 0) return;
      mo = monthIdx + 1;
      d = Number(m![1]);
      y = m![3] ? Number(m![3]) : fromYear + (mo < fromMonth - 6 ? 1 : 0);
    }
    const word = kindMatch[0].toLowerCase();
    const kind: ScheduleKind = word.startsWith("end") ? "end" : word.startsWith("banish") ? "banishment" : "murder";
    const after = line.slice(line.indexOf(kindMatch[0]) + kindMatch[0].length);
    const start = after.match(/\d+/);
    rows.push({
      date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      kind,
      start: start ? Number(start[0]) : undefined,
      line: lineNo,
    });
  });

  // Spreadsheets are often newest-first: order by date, and within a day by the
  // "remaining at start" count (highest first), falling back to reading order.
  const firstDate = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0]?.date ?? "");
  const descending = rows.length > 1 && rows[0].date > rows[rows.length - 1].date;
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.start !== undefined && b.start !== undefined ? b.start - a.start : descending ? b.line - a.line : a.line - b.line),
  );
  const first = rows.find((r) => r.date === firstDate && r.start !== undefined);
  return { items: rows.map(({ date, kind }) => ({ date, kind })), plannedStart: first?.start };
}

/** The schedule proposed for the November–December 2026 game. */
export const PROPOSED_SCHEDULE = `Wednesday	9th December	End Game	5
Wednesday	9th December	Banishment	6	5
Tuesday	8th December	Banishment	7	6
Monday	7th December	Murder	8	7
Friday	4th December	Banishment	9	8
Friday	4th December	Murder	10	9
Thursday	3rd December	Banishment	11	10
Wednesday	2nd December	Murder	12	11
Wednesday	2nd December	Banishment	13	12
Monday	30th November	Murder	14	13
Friday	27th November	Banishment	15	14
Thursday	26th November	Murder	16	15
Wednesday	25th November	Banishment	17	16
Tuesday	24th November	Murder	18	17
Monday	23rd November	Banishment	19	18
Friday	20th November	Murder	20	19
Friday	20th November	Banishment	21	20
Thursday	19th November	Murder	22	21
Wednesday	18th November	Banishment	23	22
Monday	16th November	Murder	24	23
Friday	13th November	Banishment	25	24
Thursday	12th November	Murder	26	25`;
