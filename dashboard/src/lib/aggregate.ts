import type { Account, Budget, Category, Debt, Direction, Transaction } from "@/types";
import { monthKeyOf } from "@/lib/format";

/**
 * Pure aggregation. No fetching, no React — testable in isolation.
 *
 * Rules:
 *  - amounts always positive; `direction` carries the sign.
 *  - `planned` excluded from all ACTUAL figures; summed separately.
 *  - `direction === "internal"` = own-account transfer. Excluded from every
 *    income/expense/profit figure — a move between your own accounts creates
 *    no income and destroys no money.
 *  - a refund is an expense row that counts NEGATIVELY. See signedExpense().
 *  - account balances ARE derived here, from transactions. See accountBalances().
 */

const isActual = (t: Transaction) => !t.planned;

/**
 * What an expense row contributes to a spend total.
 *
 * A refund (Canva subscription reversed, festival ticket resold) is money
 * returning on something you already booked as spend, so it belongs in that
 * category as a negative — not in income, and not in a bucket of its own.
 * Booking it as income both inflated income and left the original category
 * overstated by the refunded amount.
 *
 * Rows are not paired against the original and cancelled, because partial
 * refunds (€3 back on a €278 ticket) have nothing to cancel.
 */
const signedExpense = (t: Transaction) => (t.refund ? -t.amount : t.amount);
/**
 * Internal transfers are flagged by `direction`, with a NULL category.
 * (Pre-SQLite this was `category === "internal"`; that predicate matched
 * nothing after the migration, so all 102 internal rows — €46,697 of pure
 * movement — were being counted as real income and expense app-wide.)
 */
const isInternal = (t: Transaction) => t.direction === "internal";

export interface MonthSummary {
  income: number;
  expense: number;
  profit: number;
  savingsRate: number; // 0..1
}

/** Income/expense/profit for one month, excluding planned + internal. */
export function byMonth(txs: Transaction[], monthKey: string): MonthSummary {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (!isActual(t) || isInternal(t)) continue;
    if (monthKeyOf(t.date) !== monthKey) continue;
    if (t.direction === "income") income += t.amount;
    else expense += signedExpense(t);
  }
  const profit = income - expense;
  return { income, expense, profit, savingsRate: income > 0 ? profit / income : 0 };
}

/** Year-to-date summary for a given year (defaults to year of monthKey). */
export function byYear(txs: Transaction[], year: string): MonthSummary {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (!isActual(t) || isInternal(t)) continue;
    if (!t.date.startsWith(year + "-")) continue;
    if (t.direction === "income") income += t.amount;
    else expense += signedExpense(t);
  }
  const profit = income - expense;
  return { income, expense, profit, savingsRate: income > 0 ? profit / income : 0 };
}

export interface CategorySlice {
  id: string;
  name: string;
  color: string;
  value: number;
}

/** Rows imported without a category land in one visible bucket, not silently. */
export const UNCATEGORIZED = "uncategorized";
const catKey = (t: Transaction) => t.category ?? UNCATEGORIZED;
const catLabel = (id: string, c?: Category) => ({
  name: c?.name ?? (id === UNCATEGORIZED ? "Uncategorized" : id),
  color: c?.color ?? "#9ca3af",
});

/** Expense (or income) grouped by category for one month. Excludes internal + planned. */
export function byCategoryForMonth(
  txs: Transaction[],
  categories: Category[],
  monthKey: string,
  direction: Direction = "expense",
): CategorySlice[] {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string, number>();
  for (const t of txs) {
    if (!isActual(t) || isInternal(t)) continue;
    if (t.direction !== direction) continue;
    if (monthKeyOf(t.date) !== monthKey) continue;
    const v = direction === "expense" ? signedExpense(t) : t.amount;
    totals.set(catKey(t), (totals.get(catKey(t)) ?? 0) + v);
  }
  return [...totals.entries()]
    .map(([id, value]) => ({ id, ...catLabel(id, catMap.get(id)), value }))
    .sort((a, b) => b.value - a.value);
}

export interface TrendPoint {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  net: number;
}

/** Build a list of N month-keys ending at endMonth (inclusive). */
export function monthList(endMonth: string, n: number): string[] {
  const [y, m] = endMonth.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function prevMonth(monthKey: string): string {
  return monthList(monthKey, 2)[0];
}

/** 12-month income/expense/net trend ending at endMonth. */
export function trend12(txs: Transaction[], endMonth: string, n = 12): TrendPoint[] {
  const months = monthList(endMonth, n);
  const idx = new Map(months.map((mo) => [mo, { income: 0, expense: 0 }]));
  for (const t of txs) {
    if (!isActual(t) || isInternal(t)) continue;
    const mk = monthKeyOf(t.date);
    const bucket = idx.get(mk);
    if (!bucket) continue;
    if (t.direction === "income") bucket.income += t.amount;
    else bucket.expense += signedExpense(t);
  }
  return months.map((mo) => {
    const b = idx.get(mo)!;
    return { month: mo, income: b.income, expense: b.expense, net: b.income - b.expense };
  });
}

export type BudgetStatus = "on" | "near" | "over";

export interface BudgetRow {
  id: string;
  name: string;
  color: string;
  budget: number;
  actual: number;
  pct: number; // 0..(>1)
  status: BudgetStatus;
  avg3: number; // trailing 3-month avg (months before selected)
}

/** Budget vs actual per category for a month + trailing 3-mo avg. */
export function budgetVsActual(
  txs: Transaction[],
  categories: Category[],
  budget: Budget,
  monthKey: string,
): BudgetRow[] {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const actualMonth = new Map<string, number>();
  for (const t of txs) {
    if (!isActual(t) || isInternal(t) || t.direction !== "expense") continue;
    if (monthKeyOf(t.date) !== monthKey) continue;
    actualMonth.set(catKey(t), (actualMonth.get(catKey(t)) ?? 0) + signedExpense(t));
  }

  // trailing 3 months BEFORE selected
  const prior = monthList(prevMonth(monthKey), 3);
  const priorSet = new Set(prior);
  const avgTotals = new Map<string, number>();
  for (const t of txs) {
    if (!isActual(t) || isInternal(t) || t.direction !== "expense") continue;
    if (!priorSet.has(monthKeyOf(t.date))) continue;
    avgTotals.set(catKey(t), (avgTotals.get(catKey(t)) ?? 0) + signedExpense(t));
  }

  const ids = new Set<string>([...Object.keys(budget.monthly), ...actualMonth.keys()]);
  const rows: BudgetRow[] = [];
  for (const id of ids) {
    const b = budget.monthly[id] ?? 0;
    const actual = actualMonth.get(id) ?? 0;
    const pct = b > 0 ? actual / b : actual > 0 ? Infinity : 0;
    const status: BudgetStatus = pct > 1 ? "over" : pct >= 0.85 ? "near" : "on";
    rows.push({
      id,
      ...catLabel(id, catMap.get(id)),
      budget: b,
      actual,
      pct,
      status,
      avg3: (avgTotals.get(id) ?? 0) / 3,
    });
  }
  return rows.sort((a, b) => b.pct - a.pct);
}

export interface AccountBalance {
  id: string;
  name: string;
  balance: number;
  share: number; // 0..1 of total cash
}

/**
 * What one transaction does to the balance of its OWN account.
 *
 * Mirrors BALANCE_SQL in reconcile_balances.py — keep the two in step.
 *
 * An internal row moves only the account it sits on, by `flow`. It deliberately
 * does NOT also credit `transfer_to`: where both ends export statements
 * (mBank ↔ mCredit) each side already contributes its own row, and crediting
 * the destination too would count every such transfer twice.
 *
 * A `flow`-less internal row contributes 0. That is not a silent failure — the
 * server refuses to create one, and the importer derives it from the statement's
 * sign before any rule can overwrite `direction`.
 */
function balanceDelta(t: Transaction): number {
  if (t.planned) return 0; // not real money yet
  switch (t.direction) {
    case "income":
      return t.amount;
    case "expense":
      return t.refund ? t.amount : -t.amount; // a refund puts money back
    case "internal":
      return t.flow === "in" ? t.amount : t.flow === "out" ? -t.amount : 0;
  }
}

/**
 * Account balances are DERIVED — a pure sum of the account's transactions.
 *
 * They were briefly stored on `accounts.balance` and typed in by hand, because
 * the naive earlier derivation could not reconcile: the statements do not reach
 * back to when each account was opened, so the opening position was missing and
 * every account came out steeply negative. Hand-maintaining them just moved the
 * problem — the numbers went stale the moment a statement was imported.
 *
 * The gap is closed in the ledger instead. reconcile_balances.py writes one
 * `internal` row per account for exactly the missing opening amount, so the sum
 * lands on the real balance and keeps landing there as new statements arrive.
 */
export function accountBalances(accounts: Account[], txs: Transaction[]): AccountBalance[] {
  const sums = new Map<string, number>(accounts.map((a) => [a.id, 0]));
  for (const t of txs) {
    if (!sums.has(t.account)) continue;
    sums.set(t.account, sums.get(t.account)! + balanceDelta(t));
  }
  // Overdrawn accounts must not eat into the share denominator, or a single
  // negative balance pushes every other account's share above 100%.
  const total = [...sums.values()].reduce((s, v) => s + Math.max(0, v), 0);
  return accounts
    .map((a) => {
      const balance = round2(sums.get(a.id) ?? 0);
      return {
        id: a.id,
        name: a.name,
        balance,
        share: total > 0 ? Math.max(0, balance) / total : 0,
      };
    })
    .sort((x, y) => y.balance - x.balance);
}

/** Float noise is guaranteed when summing hundreds of 2-decimal amounts. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Total usable cash. Credit accounts are excluded — a card's balance is what you
 * OWE, and folding it into cash would both understate cash and double-count the
 * card, which totalDebt() already accounts for.
 */
export function totalCash(accounts: Account[], txs: Transaction[]): number {
  const cashAccounts = accounts.filter((a) => a.type !== "credit");
  return round2(accountBalances(cashAccounts, txs).reduce((s, a) => s + a.balance, 0));
}

/**
 * What a credit card currently has drawn on it.
 *
 * Derived, not stored: card spend is an expense on the card's account and a
 * repayment is an internal transfer in, so the account balance is already
 * exactly the negative of the outstanding amount and updates itself. The
 * `debts.balance` column used to hold this by hand and went stale every cycle.
 *
 * Clamped at 0 — an overpaid card is a credit, not a negative debt.
 */
export function cardOutstanding(debt: Debt, accounts: Account[], txs: Transaction[]): number {
  if (!debt.account) return debt.balance;
  const acct = accountBalances(accounts, txs).find((a) => a.id === debt.account);
  return acct ? Math.max(0, -acct.balance) : debt.balance;
}

/**
 * What you owe. `owed_to_me` is an asset, so it is excluded here.
 *
 * Credit-card debt comes from the card's account balance; every other kind of
 * debt (family loans) has no transaction stream to derive from and keeps its
 * stored balance.
 */
export function totalDebt(debts: Debt[], accounts: Account[] = [], txs: Transaction[] = []): number {
  return round2(
    debts
      .filter((d) => d.kind !== "owed_to_me")
      .reduce(
        (s, d) =>
          s + (d.kind === "credit_card" ? cardOutstanding(d, accounts, txs) : d.balance),
        0,
      ),
  );
}

/** Cash + money owed to you − money you owe. */
export function netWorth(accounts: Account[], txs: Transaction[], debts: Debt[] = []): number {
  const owedToMe = debts.filter((d) => d.kind === "owed_to_me").reduce((s, d) => s + d.balance, 0);
  return round2(totalCash(accounts, txs) + owedToMe - totalDebt(debts, accounts, txs));
}

export interface CreditCardStatus {
  debt: Debt;
  /**
   * Total drawn on the card — DERIVED from its account balance, so it moves the
   * moment you spend or repay. Not the same thing as `due`.
   */
  outstanding: number;
  /**
   * The statement figure: what must be paid by `due_date` to avoid interest.
   * Typed in from the bank each cycle — it cannot be derived reliably, because
   * the bank's posting dates differ from transaction dates and being wrong here
   * costs a fee.
   */
  due: number | null;
  available: number; // limit − outstanding
  utilization: number; // 0..1
  daysToDue: number | null;
  /** true once the statement has reset and the due figure has not been updated */
  dueStale: boolean;
}

/** Credit-card view of the debt ledger: headroom + days until the payment is due. */
export function creditCards(
  debts: Debt[],
  today: string,
  accounts: Account[] = [],
  txs: Transaction[] = [],
): CreditCardStatus[] {
  return debts
    .filter((d) => d.kind === "credit_card")
    .map((d) => {
      const limit = d.credit_limit ?? 0;
      const outstanding = cardOutstanding(d, accounts, txs);
      return {
        debt: d,
        outstanding,
        due: d.due_amount ?? null,
        available: Math.max(0, limit - outstanding),
        utilization: limit > 0 ? outstanding / limit : 0,
        daysToDue: d.due_date ? daysBetween(today, d.due_date) : null,
        // the due date has passed, so the statement has since reset and the
        // figure on screen is last cycle's — nudge rather than quietly mislead
        dueStale: !!d.due_date && daysBetween(today, d.due_date) < 0,
      };
    });
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to + "T00:00:00") - Date.parse(from + "T00:00:00");
  return Math.round(ms / 86_400_000);
}

export interface PlannedTotals {
  plannedIncome: number;
  plannedExpense: number;
}

export function plannedTotals(txs: Transaction[]): PlannedTotals {
  let plannedIncome = 0;
  let plannedExpense = 0;
  for (const t of txs) {
    if (!t.planned || isInternal(t)) continue;
    if (t.direction === "income") plannedIncome += t.amount;
    else plannedExpense += signedExpense(t);
  }
  return { plannedIncome, plannedExpense };
}

/** Income grouped by channel (income-typed category). monthKey omitted = YTD of given year. */
export function incomeByChannel(
  txs: Transaction[],
  categories: Category[],
  monthKey: string | null,
  year?: string,
): CategorySlice[] {
  const catMap = new Map(categories.filter((c) => c.type === "income").map((c) => [c.id, c]));
  const totals = new Map<string, number>();
  for (const t of txs) {
    if (!isActual(t) || isInternal(t) || t.direction !== "income") continue;
    if (monthKey) {
      if (monthKeyOf(t.date) !== monthKey) continue;
    } else if (year) {
      if (!t.date.startsWith(year + "-")) continue;
    }
    totals.set(catKey(t), (totals.get(catKey(t)) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([id, value]) => ({ id, ...catLabel(id, catMap.get(id)), value }))
    .sort((a, b) => b.value - a.value);
}

/** N most recent actual transactions, date desc. */
export function recent(txs: Transaction[], n = 8): Transaction[] {
  return [...txs]
    .filter(isActual)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, n);
}
