import { useMemo, useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { AddBudgetItemDialog } from "@/components/AddBudgetItemDialog";
import { DeleteButton } from "@/components/DeleteButton";
import { useApp } from "@/app-context";
import { budgetVsActual, type BudgetStatus } from "@/lib/aggregate";
import { fmtEUR0, fmtMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<BudgetStatus, string> = { on: "On track", near: "Near", over: "Over" };
const STATUS_CLS: Record<BudgetStatus, string> = {
  on: "bg-income/10 text-income",
  near: "bg-warn/15 text-warn",
  over: "bg-expense/10 text-expense",
};

/**
 * Inline editor for one category's monthly limit.
 *
 * Submitting an empty field clears the budget rather than setting it to zero —
 * those mean different things: a cleared category drops out of the budget list
 * entirely, where a zero-budget category would sit there permanently "over".
 */
function LimitEditor({
  category,
  current,
  onDone,
}: {
  category: string;
  current: number;
  onDone: () => void;
}) {
  const { updateBudget } = useApp();
  const [value, setValue] = useState(current > 0 ? String(current) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function commit() {
    const trimmed = value.trim();
    const n = trimmed === "" ? null : Number(trimmed);
    if (n !== null && !(n >= 0)) return setErr("Must be 0 or more.");
    setBusy(true);
    setErr(null);
    try {
      await updateBudget(category, n);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          type="number"
          step="10"
          min="0"
          inputMode="decimal"
          placeholder="No budget"
          className="h-9 w-28"
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
          aria-label="Save budget"
          className="key rounded-[8px] bg-paper p-1.5 text-income hover:bg-gray-100"
        >
          <Check size={16} strokeWidth={2} />
        </button>
        <button
          onClick={onDone}
          disabled={busy}
          aria-label="Cancel"
          className="key rounded-[8px] bg-paper p-1.5 text-gray-400 hover:bg-gray-100 hover:text-ink"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      {err && <p className="text-xs text-expense">{err}</p>}
    </div>
  );
}

export function BudgetView() {
  const { data, monthKey, deleteCategory } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const all = useMemo(
    () => budgetVsActual(data.transactions, data.categories, data.budget, monthKey),
    [data, monthKey],
  );
  // budgeted categories by default; "show all" exposes the unbudgeted ones so
  // they can be given a limit without leaving the page
  const rows = showAll ? all : all.filter((r) => r.budget > 0);

  const budgetedCount = all.filter((r) => r.budget > 0).length;
  const totalBudget = all.reduce((s, r) => s + r.budget, 0);
  const totalActual = all.filter((r) => r.budget > 0).reduce((s, r) => s + r.actual, 0);
  const totalAvg = all.filter((r) => r.budget > 0).reduce((s, r) => s + r.avg3, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[22px] font-semibold md:text-[24px]">Budget</h2>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-gray-400">{fmtMonthLabel(monthKey)}</span>
          <Button variant="secondary" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Budgeted only" : `Show all (${all.length - budgetedCount} more)`}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} strokeWidth={2} />
            Add item
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-3 gap-3 p-4 md:gap-4 md:p-6">
          <Total label="Budgeted" value={totalBudget} />
          <Total label="Actual" value={totalActual} tone={totalActual > totalBudget ? "expense" : "income"} />
          <Total label="3-mo avg" value={totalAvg} muted />
        </CardContent>
      </Card>

      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-3">
        {rows.map((r) => {
          const pct = r.pct === Infinity ? 1.5 : r.pct;
          const unbudgeted = r.budget <= 0;
          return (
            <Card key={r.id} className="transition-shadow duration-200 hover:shadow-drop">
              <CardContent className="p-4 md:p-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                    <span className="truncate">{r.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {unbudgeted ? (
                      <Badge className="text-gray-400">No budget</Badge>
                    ) : (
                      <Badge className={STATUS_CLS[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    )}
                    {/* Deletes the category itself, budget and all. The server
                        refuses while transactions still use it and says how
                        many — clearing the limit (edit → empty) is the milder
                        option it points at. */}
                    <DeleteButton
                      label={r.name}
                      description={
                        <>
                          This removes the <strong>{r.name}</strong> category and its budget. It
                          can only be deleted while no transactions use it — to keep the category
                          but stop budgeting it, edit the amount and leave it empty instead.
                        </>
                      }
                      onDelete={() => deleteCategory(r.id)}
                      className="-mr-1"
                    />
                  </span>
                </div>

                {editing === r.id ? (
                  <LimitEditor category={r.id} current={r.budget} onDone={() => setEditing(null)} />
                ) : (
                  <button
                    onClick={() => setEditing(r.id)}
                    className="group flex w-full items-center gap-2 text-left"
                    aria-label={`Edit ${r.name} budget`}
                  >
                    <span className="tnum text-[15px]">
                      {fmtEUR0(r.actual)}{" "}
                      <span className="text-gray-400">
                        / {unbudgeted ? "—" : fmtEUR0(r.budget)}
                      </span>
                    </span>
                    <Pencil
                      size={12}
                      strokeWidth={2}
                      className="text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 md:opacity-0"
                    />
                  </button>
                )}

                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{
                      width: unbudgeted ? "0%" : `${Math.min(Math.max(pct, 0), 1) * 100}%`,
                      background: r.status === "over" ? "var(--expense)" : r.color,
                    }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-xs text-gray-400">
                  <span>{unbudgeted ? "untracked" : `${Math.round(pct * 100)}% used`}</span>
                  <span className="tnum">3-mo avg {fmtEUR0(r.avg3)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AddBudgetItemDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function Total({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: number;
  tone?: "income" | "expense";
  muted?: boolean;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium text-gray-600">{label}</div>
      <div
        className={cn(
          "tnum text-[20px] font-bold md:text-[24px]",
          muted && "text-gray-400",
          tone === "income" && "text-income",
          tone === "expense" && "text-expense",
        )}
      >
        {fmtEUR0(value)}
      </div>
    </div>
  );
}
