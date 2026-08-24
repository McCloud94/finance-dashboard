import { useCallback, useEffect, useState } from "react";
import type { ApiData, Direction, Flow, Transaction } from "@/types";

interface UseData {
  data: ApiData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  addEntry: (entry: NewEntry) => Promise<Transaction>;
  updateTransaction: (id: string, fields: TxEdit) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;
  updateDebt: (id: string, fields: DebtEdit) => Promise<void>;
  /** set a category's monthly budget; null clears it */
  updateBudget: (category: string, monthlyLimit: number | null) => Promise<void>;
}

/** The only debt fields the dashboard writes — mirrors EDITABLE_DEBT_FIELDS. */
export interface DebtEdit {
  due_amount?: number | null;
  due_date?: string | null;
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
      setError("Could not reach the data server. Start it with: python3 serve.py");
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

  return {
    data, loading, error, reload: load, addEntry, updateTransaction,
    deleteTransaction, updateDebt, updateBudget,
  };
}
