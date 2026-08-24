import { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, Pencil, RefreshCw, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { useApp } from "@/app-context";
import { creditCards } from "@/lib/aggregate";
import { fmtEUR0, todayDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "in 7 days" / "tomorrow" / "3 days overdue" — the number alone isn't readable. */
function dueLabel(days: number | null): { text: string; urgent: boolean } {
  if (days === null) return { text: "no due date", urgent: false };
  if (days < 0) return { text: `${Math.abs(days)} days overdue`, urgent: true };
  if (days === 0) return { text: "due today", urgent: true };
  if (days === 1) return { text: "due tomorrow", urgent: true };
  return { text: `due in ${days} days`, urgent: days <= 5 };
}

/**
 * Editor for the statement figures.
 *
 * These are the only two numbers on this card that are typed in rather than
 * derived, because they cannot be computed safely: the bank's posting dates
 * differ from transaction dates, and underpaying costs interest. They live here
 * rather than in data/debts.json so updating them on the 3rd is a click, not a
 * file edit plus a re-seed.
 */
function StatementEditor({
  debtId,
  due,
  dueDate,
  onDone,
}: {
  debtId: string;
  due: number | null;
  dueDate: string | null;
  onDone: () => void;
}) {
  const { updateDebt } = useApp();
  const [amount, setAmount] = useState(due != null ? String(due) : "");
  const [date, setDate] = useState(dueDate ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function commit() {
    const n = amount.trim() === "" ? null : Number(amount);
    if (n != null && !(n >= 0)) return setErr("Amount must be 0 or more.");
    setBusy(true);
    setErr(null);
    try {
      await updateDebt(debtId, { due_amount: n, due_date: date || null });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          type="number"
          step="0.01"
          min="0"
          placeholder="Due amount"
          className="h-9 w-32"
          value={amount}
          disabled={busy}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void commit()}
        />
        <Input
          type="date"
          className="h-9 w-40"
          value={date}
          disabled={busy}
          onChange={(e) => setDate(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void commit()}
        />
        <button onClick={() => void commit()} disabled={busy} className="text-income">
          <Check size={16} strokeWidth={2} />
        </button>
        <button onClick={onDone} disabled={busy} className="text-gray-400">
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      {err && <p className="text-xs text-expense">{err}</p>}
    </div>
  );
}

/**
 * `className` replaces the default wrapper grid. Accounts passes "contents" so
 * the cards become items of ITS grid and can sit beside net worth; on its own
 * (Debt view) the widget still lays itself out.
 */
export function CreditCardWidget({ className }: { className?: string } = {}) {
  const { data } = useApp();
  const cards = useMemo(
    () => creditCards(data.debts ?? [], todayDate(), data.accounts, data.transactions),
    [data.debts, data.accounts, data.transactions],
  );
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    setEditing(null);
  }, [data.debts]);

  if (cards.length === 0) return null;

  return (
    <div className={className ?? "grid grid-cols-1 gap-4 lg:grid-cols-2"}>
      {cards.map(({ debt, outstanding, due, available, utilization, daysToDue, dueStale }) => {
        const label = dueLabel(daysToDue);
        const pct = Math.min(1, utilization);
        return (
          <Card key={debt.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <CreditCard size={15} strokeWidth={1.5} className="text-gray-400" />
                  {debt.name}
                </span>
                {due != null && (
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      label.urgent ? "bg-expense/10 text-expense" : "bg-gray-100 text-gray-600",
                    )}
                  >
                    {label.text}
                  </span>
                )}
              </div>

              {/* Two different numbers, deliberately shown together.
                  `outstanding` is everything drawn on the card, derived from the
                  card account's transactions. `due` is only what this statement
                  demands by due_date to avoid interest. Paying `due` clears the
                  fee; it does not clear the card. Showing one without the other
                  is how you end up thinking a paid statement means a paid card. */}
              <div className="mt-3 flex flex-wrap items-baseline gap-2">
                <span className="tnum text-[28px] font-bold text-expense">
                  {fmtEUR0(outstanding)}
                </span>
                <span className="text-[13px] text-gray-400">outstanding</span>
              </div>

              {editing === debt.id ? (
                <StatementEditor
                  debtId={debt.id}
                  due={due}
                  dueDate={debt.due_date ?? null}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <button
                  onClick={() => setEditing(debt.id)}
                  className="group mt-1 flex items-center gap-2 text-[13px]"
                >
                  {due != null ? (
                    <>
                      <span className="tnum font-medium">{fmtEUR0(due)}</span>
                      <span className="text-gray-400">
                        due from statement
                        {debt.due_date && ` · ${debt.due_date}`}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-400">set statement due…</span>
                  )}
                  <Pencil
                    size={12}
                    strokeWidth={2}
                    className="text-gray-400 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </button>
              )}

              {/* The prose explanation here was replaced by a chip. The signal
                  still has to survive — a passed due date means the figure on
                  screen is last month's — but it reads as a status, not a
                  paragraph of instructions. */}
              {dueStale && editing !== debt.id && (
                <button
                  onClick={() => setEditing(debt.id)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 text-xs font-medium text-warn transition-colors hover:bg-warn/25"
                >
                  <RefreshCw size={11} strokeWidth={2} />
                  Statement reset
                </button>
              )}

              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500 ease-out",
                    pct >= 0.9 ? "bg-brand-red" : pct >= 0.7 ? "bg-brand-amber" : "bg-brand-green",
                  )}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-gray-400">
                <span>
                  <span className="tnum text-ink">{fmtEUR0(outstanding)}</span> of{" "}
                  <span className="tnum">{fmtEUR0(debt.credit_limit ?? 0)}</span> used
                </span>
                <span>
                  <span className="tnum text-ink">{fmtEUR0(available)}</span> available
                </span>
              </div>

            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
