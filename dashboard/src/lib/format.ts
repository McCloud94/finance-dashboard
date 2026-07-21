const eur = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const eur0 = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Single source of EUR formatting. Pass cents=false for whole-euro display. */
export function fmtEUR(n: number, cents = true): string {
  return (cents ? eur : eur0).format(n);
}

/**
 * Whole-euro EUR, no cents.
 *
 * Used on the dashboard views (Overview, Budget) where the numbers are
 * aggregates — a net worth or a monthly budget is a magnitude you scan, and
 * two decimal places there are noise that also makes the columns harder to
 * compare at a glance. Ledger-level views keep cents, because there the exact
 * figure is the point.
 */
export const fmtEUR0 = (n: number): string => eur0.format(n);

/** Signed delta with sign prefix, e.g. "+12.5%" */
export function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/** "2026-06" → "Jun 2026" */
export function fmtMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

/** "2026-06" → "Jun" */
export function fmtMonthShort(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
}

export function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}
