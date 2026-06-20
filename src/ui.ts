/**
 * Tiny terminal styling + layout helpers for the decision trace.
 *
 * Colour is enabled only for an interactive TTY and is disabled when NO_COLOR
 * is set (https://no-color.org) — so piped/recorded output stays clean and
 * scripts never see escape codes they don't expect.
 */

const COLOR_ENABLED =
  Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  cyan: 36,
  gray: 90,
} as const;

export type Style = Exclude<keyof typeof CODES, "reset">;

export function paint(text: string, ...styles: Style[]): string {
  if (!COLOR_ENABLED || styles.length === 0) return text;
  const prefix = styles.map((s) => `\x1b[${CODES[s]}m`).join("");
  return `${prefix}${text}\x1b[0m`;
}

export const WIDTH = 60;
const LABEL_WIDTH = 13;

/** Heavy horizontal rule (section boundary). */
export function heavyRule(): string {
  return paint("═".repeat(WIDTH), "gray");
}

/** Thin horizontal rule (sub-section boundary). */
export function thinRule(): string {
  return paint("─".repeat(WIDTH), "gray");
}

/** A top-level section label, e.g. "INTENT". */
export function section(label: string, note?: string): string {
  const head = paint(`  ${label}`, "bold", "cyan");
  return note ? `${head}  ${paint(note, "dim")}` : head;
}

/** An aligned "label   value" field line. */
export function field(label: string, value: string): string {
  return `    ${paint(label.padEnd(LABEL_WIDTH), "dim")}${value}`;
}

/** Indent a (possibly multi-line) block under a section. */
export function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => paint("    │ ", "gray") + paint(line, "dim"))
    .join("\n");
}

/** A bordered banner box (for the punchline). */
export function box(line: string, ...styles: Style[]): string {
  const inner = ` ${line} `;
  const top = `  ╔${"═".repeat(inner.length)}╗`;
  const mid = `  ║${inner}║`;
  const bot = `  ╚${"═".repeat(inner.length)}╝`;
  return [top, mid, bot].map((l) => paint(l, ...styles)).join("\n");
}
