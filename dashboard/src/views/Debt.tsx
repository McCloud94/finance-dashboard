import { useMemo, useState } from "react";
import { Check, HandCoins, Pencil, Plus, Users, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { CreditCardWidget } from "@/components/CreditCardWidget";
import { AddDebtDialog } from "@/components/AddDebtDialog";
import { DeleteButton } from "@/components/DeleteButton";
import { EmptyState } from "@/components/States";
import { useApp } from "@/app-context";
import { totalCash, totalDebt } from "@/lib/aggregate";
import { fmtEUR0 } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Debt } from "@/types";

/**
 * Inline editor for a loan's outstanding amount.
 *
 * Loans have no transaction stream to derive a balance from — a family loan is
 * repaid in cash or across accounts the dashboard may never see — so the number
 * is typed in and edited here as it is paid down. (A credit card is the
 * opposite: its outstanding IS derived, and the server refuses to be told
 * otherwise.)
 */
function BalanceEditor({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const { updateDebt } = useApp();
  const [value, setValue] = useState(String(debt.balance ?? 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function commit() {
    const n = Number(value.trim());
    if (!(n >= 0)) return setErr("Must be 0 or more.");
    setBusy(true);
    setErr(null);
    try {
      await updateDebt(debt.id, { balance: n });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          type="number"
          step="10"
          min="0"
          inputMode="decimal"
          className="h-8 w-24 text-right"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") onDone();
          }}
        />
        <button
          onClick={() => void commit()}
          disabled={busy}
          aria-label="Save amount"
          className="key rounded-[8px] bg-paper p-1.5 text-income hover:bg-gray-100"
        >
          <Check size={15} strokeWidth={2} />
        </button>
        <button
          onClick={onDone}
          disabled={busy}
          aria-label="Cancel"
          className="key rounded-[8px] bg-paper p-1.5 text-gray-400 hover:bg-gray-100 hover:text-ink"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
      {err && <p className="text-xs text-expense">{err}</p>}
    </div>
  );
}

function DebtRow({ d, max }: { d: Debt; max: number }) {
  const { deleteDebt } = useApp();
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{d.name}</span>
          {d.counterparty && (
            <span className="truncate text-[13px] text-gray-400">{d.counterparty}</span>
          )}
        </span>
        {editing ? (
          <BalanceEditor debt={d} onDone={() => setEditing(false)} />
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setEditing(true)}
              aria-label={`Edit ${d.name} amount`}
              className="group flex items-center gap-1.5"
            >
              <span className="tnum font-medium">{fmtEUR0(d.balance)}</span>
              <Pencil
                size={12}
                strokeWidth={2}
                className="text-gray-400 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </button>
            <DeleteButton
              label={d.name}
              description={<>This removes {d.name} from your debts. No transactions are touched.</>}
              onDelete={() => deleteDebt(d.id)}
            />
          </span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-expense"
          style={{ width: `${max > 0 ? (d.balance / max) * 100 : 0}%` }}
        />
      </div>
      {d.note && <p className="mt-1 text-xs text-gray-400">{d.note}</p>}
    </div>
  );
}

export function DebtView() {
  const { data } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const debts = data.debts ?? [];

  const loans = useMemo(() => debts.filter((d) => d.kind === "loan"), [debts]);
  const owedToMe = useMemo(() => debts.filter((d) => d.kind === "owed_to_me"), [debts]);
  const owed = useMemo(
    () => totalDebt(debts, data.accounts, data.transactions),
    [debts, data.accounts, data.transactions],
  );
  const cash = useMemo(
    () => totalCash(data.accounts, data.transactions),
    [data.accounts, data.transactions],
  );

  const maxLoan = Math.max(1, ...loans.map((d) => d.balance));
  const maxOwed = Math.max(1, ...owedToMe.map((d) => d.balance));

  if (debts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <EmptyState
          title="No debts tracked"
          hint="Add a loan, something someone owes you, or a credit card."
        />
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} strokeWidth={2} />
          Add debt
        </Button>
        <AddDebtDialog open={addOpen} onClose={() => setAddOpen(false)} />
      </div>
    );
  }

  // How much of what you owe you could clear right now. The honest version of
  // "am I actually in the hole" — a big cash balance means very little if the
  // card is maxed and the family loans are outstanding.
  const coverage = owed > 0 ? cash / owed : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[22px] font-semibold md:text-[24px]">Debt</h2>
        <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={14} strokeWidth={2} />
          Add debt
        </Button>
      </div>

      <Card>
        <CardContent className="p-8">
          <div className="text-[13px] font-medium text-gray-600">Total owed</div>
          <div className="tnum text-[40px] font-bold leading-tight text-expense">{fmtEUR0(owed)}</div>
          <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-gray-100">
            <div
              className={cn(
                "h-full rounded-full",
                coverage >= 1 ? "bg-income" : coverage >= 0.5 ? "bg-accent" : "bg-expense",
              )}
              style={{ width: `${Math.min(1, coverage) * 100}%` }}
            />
          </div>
          <div className="mt-1.5 text-[13px] text-gray-400">
            <span className="tnum text-ink">{fmtEUR0(cash)}</span> cash covers{" "}
            <span className="tnum text-ink">{(Math.min(1, coverage) * 100).toFixed(0)}%</span> of it
          </div>
        </CardContent>
      </Card>

      <CreditCardWidget />

      {loans.length > 0 && (
        <Card>
          <CardContent>
            <h3 className="mb-1 flex items-center gap-2 text-[20px] font-semibold">
              <Users size={18} strokeWidth={1.5} className="text-gray-400" />
              I owe
            </h3>
            <p className="mb-4 text-[13px] text-gray-400">
              Money you have to pay back — a family loan, a friend, anything borrowed.
            </p>
            <div className="flex flex-col gap-4">
              {loans.map((d) => (
                <DebtRow key={d.id} d={d} max={maxLoan} />
              ))}
              <div className="flex justify-between border-t border-gray-200 pt-3 text-sm">
                <span className="font-medium">Total</span>
                <span className="tnum font-semibold text-expense">
                  {fmtEUR0(loans.reduce((s, d) => s + d.balance, 0))}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {owedToMe.length > 0 && (
        <Card>
          <CardContent>
            <h3 className="mb-4 flex items-center gap-2 text-[20px] font-semibold">
              <HandCoins size={18} strokeWidth={1.5} className="text-gray-400" />
              Owed to me
            </h3>
            <div className="flex flex-col gap-4">
              {owedToMe.map((d) => (
                <DebtRow key={d.id} d={d} max={maxOwed} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AddDebtDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
