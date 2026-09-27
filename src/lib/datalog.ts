// Small helpers for Datalog source text: split a script into top-level forms,
// strip comments, and pin queries to a point in time.

export type FormKind = "query" | "transact" | "retract" | "rule" | "unknown";

/**
 * Split a script into top-level `( ... )` forms.
 *
 * Understands string literals (parentheses inside `"..."` are ignored) and two
 * comment styles: `;` to end of line, and lines that start with `#` (the style
 * used by the Minigraf demo scripts). `#uuid "..."` is not a comment.
 */
export function splitForms(src: string): string[] {
  const forms: string[] = [];
  let depth = 0;
  let start = -1;
  let i = 0;
  let lineStart = true;

  while (i < src.length) {
    const ch = src[i];

    if (ch === "\n") {
      lineStart = true;
      i++;
      continue;
    }
    if (lineStart && (ch === " " || ch === "\t" || ch === "\r")) {
      i++;
      continue;
    }
    const atLineStart = lineStart;
    lineStart = false;

    if (ch === ";" || (atLineStart && ch === "#" && !src.startsWith("#uuid", i))) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === "(") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0 && start !== -1) {
        forms.push(src.slice(start, i + 1));
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
    i++;
  }

  if (depth > 0 && start !== -1) {
    throw new Error("Unbalanced parentheses: a form is not closed");
  }
  return forms;
}

export function formKind(form: string): FormKind {
  const m = /^\(\s*([a-z-]+)/.exec(form.trim());
  switch (m?.[1]) {
    case "query":
      return "query";
    case "transact":
      return "transact";
    case "retract":
      return "retract";
    case "rule":
      return "rule";
    default:
      return "unknown";
  }
}

/** Format a millisecond timestamp the way Minigraf accepts it (ISO 8601 UTC, whole seconds). */
export function toMinigrafTime(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

export type ValidAt = { kind: "now" } | { kind: "any" } | { kind: "at"; ms: number };

/**
 * Add `:as-of` and `:valid-at` to a `(query [...])` form so it runs at the
 * visualizer's time cursor. A clause the author already wrote wins; we only
 * fill in what is missing.
 */
export function pinQuery(form: string, asOf: number | null, validAt: ValidAt): string {
  if (formKind(form) !== "query") return form;
  const open = form.indexOf("[");
  if (open === -1) return form;
  const additions: string[] = [];
  if (asOf !== null && !/:as-of\b/.test(form)) additions.push(`:as-of ${asOf}`);
  if (!/:valid-at\b|:any-valid-time\b/.test(form)) {
    if (validAt.kind === "any") additions.push(":any-valid-time");
    else if (validAt.kind === "at") additions.push(`:valid-at "${toMinigrafTime(validAt.ms)}"`);
  }
  if (additions.length === 0) return form;
  return `${form.slice(0, open + 1)}${additions.join(" ")} ${form.slice(open + 1)}`;
}

/** Keywords that appear as the entity (first element) of a fact vector. */
export function entityKeywords(form: string): string[] {
  const out: string[] = [];
  const re = /\[\s*(:[A-Za-z0-9_\-/?.*+!<>=]+)\s+:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(form))) {
    const kw = m[1];
    if (kw !== ":find" && kw !== ":where" && kw !== ":as-of" && kw !== ":valid-at") out.push(kw);
  }
  return out;
}
