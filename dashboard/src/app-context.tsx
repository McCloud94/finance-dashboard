import { createContext, useContext } from "react";
import type { ApiData, Transaction } from "@/types";
import type { DebtEdit, NewEntry, TxEdit } from "@/hooks/useData";

export type ViewId = "overview" | "accounts" | "transactions" | "budget" | "calendar" | "debt";

export interface AppCtx {
  data: ApiData;
  monthKey: string;
  setMonthKey: (m: string) => void;
  view: ViewId;
  setView: (v: ViewId) => void;
  /** open the add-entry dialog, optionally prefilling date / category */
  openAddEntry: (prefill?: Partial<NewEntry>) => void;
  /** jump to transactions view with a filter applied */
  goToTransactions: (filter?: { category?: string; month?: string }) => void;
  addEntry: (e: NewEntry) => Promise<unknown>;
  /** edit an existing transaction — persisted as an override, survives re-import */
  updateTransaction: (id: string, fields: TxEdit) => Promise<Transaction>;
  /** remove a transaction for good — tombstoned if it came from a statement */
  deleteTransaction: (id: string) => Promise<void>;
  /** update a debt's statement figures (due_amount / due_date) */
  updateDebt: (id: string, fields: DebtEdit) => Promise<void>;
  /** set a category's monthly budget; null clears it */
  updateBudget: (category: string, monthlyLimit: number | null) => Promise<void>;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppContext");
  return ctx;
}
