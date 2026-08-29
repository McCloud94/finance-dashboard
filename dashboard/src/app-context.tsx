import { createContext, useContext } from "react";
import type { ApiData, Transaction } from "@/types";
import type {
  DebtEdit, NewAccount, NewCategory, NewDebt, NewEntry, TxEdit,
} from "@/hooks/useData";

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
  /** update a debt (statement figures, name, counterparty, limit, note, balance) */
  updateDebt: (id: string, fields: DebtEdit) => Promise<void>;
  /** add a debt: a loan, something owed to you, or a credit card */
  addDebt: (debt: NewDebt) => Promise<void>;
  deleteDebt: (id: string) => Promise<void>;
  /** set a category's monthly budget; null clears it */
  updateBudget: (category: string, monthlyLimit: number | null) => Promise<void>;
  /** add an account; a non-zero opening balance is booked as one internal row */
  addAccount: (account: NewAccount) => Promise<void>;
  /** delete an account — refused by the server while anything references it */
  deleteAccount: (id: string) => Promise<void>;
  /** add a budget item (a category, optionally with a monthly limit) */
  addCategory: (category: NewCategory) => Promise<void>;
  /** delete a category — refused by the server while transactions use it */
  deleteCategory: (id: string) => Promise<void>;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppContext");
  return ctx;
}
