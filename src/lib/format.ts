import type { ValidAt } from "./datalog";

const pad = (n: number) => String(n).padStart(2, "0");

/** `2023-06-01`, or `2023-06-01 09:20` when the time is not midnight UTC. */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "?";
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return date;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${formatDate(ms).slice(0, 10)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function formatRange(from: number, to: number | null): string {
  return `${formatDate(from)} → ${to === null ? "∞" : formatDate(to)}`;
}

export function describeValidAt(v: ValidAt, now: number): string {
  switch (v.kind) {
    case "any":
      return "any valid time";
    case "now":
      return `now (${formatDate(now).slice(0, 10)})`;
    case "at":
      return formatDate(v.ms);
  }
}

/** Value for an `<input type="datetime-local">`, in UTC. */
export function toInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export function fromInputValue(s: string): number | null {
  if (!s) return null;
  const ms = Date.parse(`${s}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}
