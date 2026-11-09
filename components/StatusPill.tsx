import type { RoundStatus } from "@/lib/rounds";

const LABEL: Record<RoundStatus, string> = {
  scheduled: "Scheduled",
  open: "Voting open",
  closed: "Closed",
  cancelled: "Cancelled",
};

export function StatusPill({ status }: { status: RoundStatus }) {
  return <span className={`status ${status}`}>{LABEL[status]}</span>;
}
