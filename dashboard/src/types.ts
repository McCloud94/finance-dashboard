/**
 * Mirrors the payload of GET /api/data exactly.
 *
 * These types drifted from reality during the SQLite migration and every bug it
 * caused was a type lie the compiler couldn't catch: `planned` was declared
 * boolean but arrived as 0/1, `category:"internal"` became
 * `direction:"internal"`. serve.py's Store.snapshot() now normalizes at the
 * boundary — keep this file honest about what it actually sends.
 */

/** 'internal' = own-account transfer. Never income or expense. */
export type Direction = "income" | "expense" | "internal";

/**
 * Which way an internal transfer moved money on its OWN account. Both legs of a
 * transfer have direction 'internal', so this is the only field carrying the
 * sign — without it a transfer cannot be added to a balance at all.
 * Always null for income/expense, where `direction` is the sign.
 */
export type Flow = "in" | "out";

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  merchant?: string | null;
  amount: number; // always positive; the sign lives in `direction` / `flow`
  direction: Direction;
  /** null for internal transfers and for rows awaiting review */
  category: string | null;
  account: string; // accounts.id
  /** the other account when direction === 'internal'. Load-bearing: when the
   *  transfer has no `counterpart` row, this is the account that gets the
   *  mirrored movement. */
  transfer_to?: string | null;
  /** set iff direction === 'internal' */
  flow?: Flow | null;
  /**
   * id of the opposite leg of this transfer, when the ledger holds one — i.e.
   * both banks exported the movement and it is already double-entered as two
   * rows. Server-computed (ledger.pair_internal); null/absent means this row is
   * the only record of the transfer and must move both accounts itself.
   */
  counterpart?: string | null;
  /**
   * Money coming back on a spend. A refund is an EXPENSE row that counts
   * negatively in its category — not income. Aggregates subtract it.
   */
  refund: boolean; // coerced from SQLite's 0/1 server-side
  note?: string | null;
  source?: string;
  planned: boolean; // coerced from SQLite's 0/1 server-side
  /** true when a dashboard edit is overlaid on the imported row */
  edited?: boolean;
  created_at?: string;
}

/** 'credit' = a credit card: its balance is negative (what you owe) and it is
 *  excluded from cash totals. */
export type AccountType = "bank" | "prop_firm" | "crypto" | "broker" | "cash" | "credit";

export interface Account {
  id: string;
  name: string;
  currency: string;
  type?: AccountType;
  /**
   * NOTE: there is deliberately no `balance` here. The server stopped sending
   * one — a balance is a pure SUM of the account's transactions, computed by
   * accountBalances() in lib/aggregate.ts. The stored column still exists in
   * SQLite as the reconcile *target*, but it is not part of this payload and
   * must not be reintroduced: two balances that can disagree is exactly the
   * class of drift this file exists to prevent.
   */
}

export type CategoryType = "income" | "expense";

export interface Category {
  id: string;
  name: string;
  color: string;
  type: CategoryType;
}

export type DebtKind = "credit_card" | "loan" | "owed_to_me";

export interface Debt {
  id: string;
  name: string;
  kind: DebtKind;
  counterparty?: string | null;
  account?: string | null;
  credit_limit?: number | null;
  /**
   * Stored outstanding. Authoritative for loans. For a credit_card it is IGNORED
   * — use cardOutstanding(), which derives it from the card account's
   * transactions so it cannot go stale.
   */
  balance: number;
  /** statement figure: pay this by due_date to avoid interest. Typed in each
   *  cycle from the bank — not derivable, and being wrong costs a fee. */
  due_amount?: number | null;
  due_date?: string | null; // YYYY-MM-DD
  note?: string | null;
}

export interface Budget {
  monthly: Record<string, number>;
  planned_income: number;
}

/**
 * A recurring date the Calendar marks — rent day, card due day, statement reset.
 * Not a transaction: it moves no money and appears in no total. Configured in
 * data/calendar.json and seeded into settings.cycle_markers, so changing what
 * the calendar says never means editing a component.
 */
export interface CycleMarker {
  day: number; // 1-31
  label: string; // shown in the calendar cell
  detail: string; // spelled out in the legend
  tone: "due" | "info"; // due = money leaves today
}

export interface ApiData {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  debts: Debt[];
  budget: Budget;
  cycle_markers?: CycleMarker[];
}
