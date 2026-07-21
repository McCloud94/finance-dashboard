import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { TxDetailDrawer } from "@/components/TxDetailDrawer";
import { useApp } from "@/app-context";
import { fmtEUR0, fmtMonthLabel } from "@/lib/format";
import type { Transaction } from "@/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** 1st / 2nd / 3rd / 4th — 11-13 are the exceptions that break the naive rule. */
function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Fixed points in the monthly money cycle. These aren't transactions — they're
 * the recurring obligations the month is shaped around, so they're rendered as
 * day markers rather than being faked as planned rows in the ledger.
 */
const CYCLE_MARKERS: Record<number, { label: string; detail: string; tone: "due" | "reset" }> = {
  25: {
    label: "Rent + card due",
    detail: "Send money to mBank: rent €915 + card due. Pay back the card.",
    tone: "due",
  },
  3: {
    label: "Statement resets",
    detail: "Card statement resets → cash out limit to Revolut → Bybit for daily spend.",
    tone: "reset",
  },
};

export function CalendarView() {
  const { data, monthKey, openAddEntry } = useApp();
  const { transactions } = data;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => transactions.find((t) => t.id === selectedId) ?? null,
    [transactions, selectedId],
  );

  const [year, month] = monthKey.split("-").map(Number);

  // group txns by day-of-month for the selected month
  const byDay = useMemo(() => {
    const map = new Map<number, Transaction[]>();
    for (const t of transactions) {
      if (t.date.slice(0, 7) !== monthKey) continue;
      const day = Number(t.date.slice(8, 10));
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(t);
    }
    return map;
  }, [transactions, monthKey]);

  // build grid cells (leading blanks for Mon-start, then days)
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[24px] font-semibold">{fmtMonthLabel(monthKey)}</h2>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-100">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-3 py-2 text-xs font-medium text-gray-600">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) return <div key={i} className="min-h-[110px] border-b border-r border-gray-200 bg-gray-100/40" />;
            const dateStr = `${monthKey}-${String(day).padStart(2, "0")}`;
            const entries = byDay.get(day) ?? [];
            const marker = CYCLE_MARKERS[day];
            return (
              <div
                key={i}
                className={cn(
                  "group min-h-[110px] border-b border-r border-gray-200 p-1.5",
                  marker && "bg-gray-100/30",
                )}
                onClick={() => entries.length === 0 && openAddEntry({ date: dateStr })}
                role={entries.length === 0 ? "button" : undefined}
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-xs text-gray-400">{day}</span>
                </div>
                {marker && (
                  <div
                    title={marker.detail}
                    className={cn(
                      "mb-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight",
                      marker.tone === "due"
                        ? "bg-expense/10 text-expense"
                        : "bg-accent-light text-accent",
                    )}
                  >
                    {marker.label}
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  {entries.slice(0, 3).map((t) => {
                    const internal = t.direction === "internal";
                    // a refund is an expense row that gives money back — it reads as a credit
                  const income = t.direction === "income" || t.refund;
                    return (
                      <button
                        key={t.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(t.id);
                        }}
                        className={cn(
                          "flex items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-gray-100",
                          t.planned && "opacity-60",
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            t.planned && "ring-1 ring-inset",
                          )}
                          style={{ background: internal ? "#9ca3af" : income ? "#3a9e6a" : "#b83828" }}
                        />
                        <span className="truncate text-gray-600 font-content">{t.name}</span>
                        <span
                          className={cn(
                            "tnum ml-auto shrink-0",
                            internal ? "text-gray-400" : income ? "text-income" : "text-expense",
                          )}
                        >
                          {fmtEUR0(t.amount)}
                        </span>
                      </button>
                    );
                  })}
                  {entries.length > 3 && (
                    <div className="px-1 text-[11px] text-gray-400">+{entries.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
        {Object.entries(CYCLE_MARKERS).map(([day, m]) => (
          <span key={day} className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                m.tone === "due" ? "bg-expense" : "bg-accent",
              )}
            />
            <span className="text-ink">{ordinal(Number(day))}</span> — {m.detail}
          </span>
        ))}
      </div>

      <TxDetailDrawer tx={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
