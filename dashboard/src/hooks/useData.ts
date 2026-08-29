import { useCallback, useEffect, useState } from "react";
import type {
  AccountType, ApiData, CategoryType, DebtKind, Direction, Flow, Transaction,
} from "@/types";

interface UseData {
  data: ApiData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  addEntry: (entry: NewEntry) => Promise<Transaction>;
  updateTransaction: (id: string, fields: TxEdit) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;
  updateDebt: (id: string, fields: DebtEdit) => Promise<void>;
  addDebt: (debt: NewDebt) => Promise<void>;
  deleteDebt: (id: string) => Promise<void>;
  /** set a category's monthly budget; null clears it */
  updateBudget: (category: string, monthlyLimit: number | null) => Promise<void>;
  /** add an account, optionally with an opening balance */
  addAccount: (account: NewAccount) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  /** add a budget item = a category, optionally with a monthly limit */
  addCategory: (category: NewCategory) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
}

/** The debt fields the dashboard writes — mirrors EDITABLE_DEBT_FIELDS. */
export interface DebtEdit {
  due_amount?: number | null;
  due_date?: string | null;
  name?: string;
  counterparty?: string | null;
  credit_limit?: number | null;
  /** loans and owed-to-me only — the server rejects it on a credit card, whose
   *  outstanding is derived from its account's transactions */
  balance?: number;
  note?: string | null;
}

export interface NewDebt {
  name: string;
  kind: DebtKind;
  counterparty?: string;
  /** required for credit_card: the account its outstanding is derived from */
  account?: string;
  credit_limit?: number | null;
  balance?: number;
  due_amount?: number | null;
  due_date?: string | null;
  note?: string;
}

export interface NewAccount {
  name: string;
  type: AccountType;
  currency?: string;
  /**
   * What is in the account today. Balances are DERIVED from transactions, so
   * this is not stored as a number to trust — it is booked as one opening
   * `internal` row (see addAccount). Without it a brand-new account starts at
   * zero and every total is wrong until the whole history is imported.
   */
  opening_balance?: number;
}

export interface NewCategory {
  name: string;
  type: CategoryType;
  monthly_limit?: number | null;
  color?: string;
}

export interface NewEntry {
  date: string;
  name: string;
  amount: number;
  direction: Direction;
  /** "" for internal transfers — a transfer belongs to no category */
  category: string;
  account: string;
  transfer_to?: string;
  /** required when direction === "internal"; it is what signs the row */
  flow?: Flow;
  refund?: boolean;
  planned?: boolean;
}

/** Fields the dashboard may edit — mirrors EDITABLE_TX_FIELDS in serve.py. */
export interface TxEdit {
  category?: string | null;
  account?: string;
  name?: string;
  note?: string | null;
  direction?: Direction;
  transfer_to?: string | null;
  flow?: Flow | null;
  refund?: boolean;
  amount?: number;
  date?: string;
  merchant?: string | null;
  /** manual entries only — the server rejects it on imported rows */
  planned?: boolean;
}

/** Local calendar day as YYYY-MM-DD (not toISOString, which is UTC and can
 *  land the row on yesterday for anyone west of Greenwich). */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function useData(): UseData {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setError("Could not reach the data server. Start it with: ./start.sh");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addEntry = useCallback(async (entry: NewEntry): Promise<Transaction> => {
    const res = await fetch("/api/transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(await readError(res));
    const body = await res.json();
    setData((d) => (d ? { ...d, transactions: [body.transaction, ...d.transactions] } : d));
    return body.transaction as Transaction;
  }, []);

  /**
   * Edit an existing transaction. The server records it in tx_overrides and
   * returns the merged row, so we splice the server's version into state rather
   * than our optimistic guess — that keeps `edited` and any server-side
   * normalization accurate without a full refetch.
   */
  const updateTransaction = useCallback(async (id: string, fields: TxEdit): Promise<Transaction> => {
    const res = await fetch(`/api/transaction/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(await readError(res));
    const body = await res.json();
    const updated = body.transaction as Transaction;
    setData((d) =>
      d ? { ...d, transactions: d.transactions.map((t) => (t.id === id ? updated : t)) } : d,
    );
    return updated;
  }, []);

  /**
   * Delete a transaction. The server hard-deletes a manually-added row and
   * tombstones an imported one, so either way it stays gone across re-imports.
   */
  const deleteTransaction = useCallback(async (id: string) => {
    const res = await fetch(`/api/transaction/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readError(res));
    setData((d) => (d ? { ...d, transactions: d.transactions.filter((t) => t.id !== id) } : d));
  }, []);

  const updateDebt = useCallback(async (id: string, fields: DebtEdit) => {
    const res = await fetch(`/api/debt/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(await readError(res));
    const body = await res.json();
    setData((d) =>
      d ? { ...d, debts: d.debts.map((x) => (x.id === id ? body.debt : x)) } : d,
    );
  }, []);

  /**
   * Set one category's monthly budget. The server returns the whole `monthly`
   * map rather than the single edited row, so we swap the map in wholesale —
   * that keeps a cleared budget (deleted row) correct, which a per-key merge
   * would miss because the key simply stops existing.
   */
  const updateBudget = useCallback(async (category: string, monthlyLimit: number | null) => {
    const res = await fetch(`/api/budget/${encodeURIComponent(category)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_limit: monthlyLimit }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const body = await res.json();
    setData((d) => (d ? { ...d, budget: { ...d.budget, monthly: body.monthly } } : d));
  }, []);

  const addDebt = useCallback(async (debt: NewDebt) => {
    const res = await fetch("/api/debt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(debt),
    });
    if (!res.ok) throw new Error(await readError(res));
    const body = await res.json();
    setData((d) => (d ? { ...d, debts: [...d.debts, body.debt] } : d));
  }, []);

  const deleteDebt = useCallback(async (id: string) => {
    const res = await fetch(`/api/debt/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readError(res));
    setData((d) => (d ? { ...d, debts: d.debts.filter((x) => x.id !== id) } : d));
  }, []);

  /**
   * Add an account, and book its opening balance as a transaction rather than
   * storing it on the account.
   *
   * The opening row is an `internal` movement with no `transfer_to`: money that
   * was already there, arriving from outside the ledger. It has to be internal
   * — booking it as income would put the user's existing savings into this
   * month's earnings and wreck every income figure and savings rate.
   */
  const addAccount = useCallback(async (account: NewAccount) => {
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: account.name,
        type: account.type,
        currency: account.currency ?? "EUR",
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const created = (await res.json()).account as { id: string };

    const opening = account.opening_balance ?? 0;
    if (opening !== 0) {
      await fetch("/api/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: todayISO(),
          name: "Opening balance",
          amount: Math.abs(opening),
          direction: "internal",
          flow: opening > 0 ? "in" : "out",
          account: created.id,
          note: "Starting balance when the account was added",
        }),
      });
    }
    // Refetch rather than splice: the opening row changes balances that several
    // views derive, and a partial local update is how those drift apart.
    await load();
  }, [load]);

  const deleteAccount = useCallback(async (id: string) => {
    const res = await fetch(`/api/account/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readError(res));
    setData((d) => (d ? { ...d, accounts: d.accounts.filter((a) => a.id !== id) } : d));
  }, []);

  const addCategory = useCallback(async (category: NewCategory) => {
    const res = await fetch("/api/category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(category),
    });
    if (!res.ok) throw new Error(await readError(res));
    const body = await res.json();
    setData((d) =>
      d
        ? {
            ...d,
            categories: [...d.categories, body.category],
            budget: body.monthly ? { ...d.budget, monthly: body.monthly } : d.budget,
          }
        : d,
    );
  }, []);

  /** Deleting a category takes its budget row with it — the server refuses
   *  while any transaction still uses it, and says how many. */
  const deleteCategory = useCallback(async (id: string) => {
    const res = await fetch(`/api/category/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readError(res));
    setData((d) => {
      if (!d) return d;
      const monthly = { ...d.budget.monthly };
      delete monthly[id];
      return {
        ...d,
        categories: d.categories.filter((c) => c.id !== id),
        budget: { ...d.budget, monthly },
      };
    });
  }, []);

  return {
    data, loading, error, reload: load, addEntry, updateTransaction,
    deleteTransaction, updateDebt, addDebt, deleteDebt, updateBudget,
    addAccount, deleteAccount, addCategory, deleteCategory,
  };
}
