import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label as RLabel,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { useApp } from "@/app-context";
import {
  byCategoryForMonth,
  byMonth,
  budgetVsActual,
  byYear,
  netWorth,
  plannedTotals,
  prevMonth,
  trend12,
} from "@/lib/aggregate";
import { fmtEUR0, fmtMonthLabel, fmtMonthShort, fmtPct } from "@/lib/format";
import { useChartTheme } from "@/hooks/useChartTheme";
import { cn } from "@/lib/utils";

export function OverviewView() {
  const { data, monthKey, setMonthKey, goToTransactions, setView } = useApp();
  // resolved from the CSS tokens, so the charts follow light/dark instead of
  // the hardcoded greys they used to carry
  const ct = useChartTheme();
  const tooltipStyle = {
    background: ct.tooltipBg,
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: 10,
    fontSize: 13,
    color: ct.text,
    boxShadow: "var(--shadow-drop)",
  };
  const { transactions, accounts, categories, budget, debts } = data;
  const year = monthKey.slice(0, 4);

  const annual = useMemo(() => byYear(transactions, year), [transactions, year]);
  const planned = useMemo(() => plannedTotals(transactions), [transactions]);
  // cash on hand minus what's owed — not derived from the transaction table
  const nw = useMemo(
    () => netWorth(accounts, transactions, debts),
    [accounts, transactions, debts],
  );
  const cur = useMemo(() => byMonth(transactions, monthKey), [transactions, monthKey]);
  const prev = useMemo(() => byMonth(transactions, prevMonth(monthKey)), [transactions, monthKey]);
  const trend = useMemo(() => trend12(transactions, monthKey), [transactions, monthKey]);
  const donut = useMemo(
    () => byCategoryForMonth(transactions, categories, monthKey, "expense"),
    [transactions, categories, monthKey],
  );
  const budgetRows = useMemo(
    () => budgetVsActual(transactions, categories, budget, monthKey),
    [transactions, categories, budget, monthKey],
  );

  const donutTotal = donut.reduce((s, d) => s + d.value, 0);

  // recharts hands clicked data wrapped (sometimes under .payload) — unwrap loosely
  const onBarClick = (d: unknown) => {
    const o = d as { month?: string; payload?: { month?: string } };
    const mk = o?.month ?? o?.payload?.month;
    if (mk) setMonthKey(mk);
  };
  const onSliceClick = (d: unknown) => {
    const o = d as { id?: string; payload?: { id?: string } };
    const id = o?.id ?? o?.payload?.id;
    if (id) goToTransactions({ category: id, month: monthKey });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* annual summary */}
      <Card className="relative overflow-hidden">
        {/* soft mesh orb */}
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--brand-blue) 30%, transparent) 0%, color-mix(in srgb, var(--brand-blue) 8%, transparent) 55%, transparent 100%)",
          }}
        />
        <CardContent className="relative p-5 md:p-8">
          <div className="mb-6 flex items-baseline justify-between">
            <div>
              <div className="text-[13px] font-medium text-gray-600">Net worth</div>
              <div className="tnum text-[26px] font-bold leading-tight md:text-[40px]">{fmtEUR0(nw)}</div>
            </div>
            <div className="text-[13px] text-gray-400">{year} year-to-date</div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label="Income" value={annual.income} tone="income" />
            <Metric label="Expenses" value={annual.expense} tone="expense" />
            <Metric label="Profit" value={annual.profit} tone={annual.profit >= 0 ? "income" : "expense"} />
            <Metric label="Planned income" value={planned.plannedIncome} muted />
            <Metric label="Planned expense" value={planned.plannedExpense} muted />
          </div>
        </CardContent>
      </Card>

      {/* 4 stat cards */}
      <div className="stagger grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Income" value={cur.income} prev={prev.income} positiveUp />
        <StatCard label="Expense" value={cur.expense} prev={prev.expense} positiveUp={false} />
        <StatCard label="Net" value={cur.profit} prev={prev.profit} positiveUp tintBorder />
        <StatCard label="Savings rate" value={cur.savingsRate} prev={prev.savingsRate} positiveUp isPct />
      </div>

      {/* trend + donut */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardContent>
            <h3 className="mb-1 text-[20px] font-semibold">Monthly trend</h3>
            <p className="mb-4 text-[13px] text-gray-400">Last 12 months · click a bar to jump to that month</p>
            <ResponsiveContainer width="100%" height={220} className="md:!h-[300px]">
              <ComposedChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke={ct.grid} vertical={false} />
                <XAxis
                  dataKey="month"
                  tickFormatter={fmtMonthShort}
                  tick={{ fill: ct.axis, fontSize: 12 }}
                  axisLine={{ stroke: ct.grid }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: ct.axis, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `€${Math.round(v / 100) / 10}k`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(l) => fmtMonthLabel(String(l))}
                  formatter={(v) => fmtEUR0(Number(v))}
                />
                <Bar
                  dataKey="income"
                  name="Income"
                  fill={ct.income}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive
                  onClick={onBarClick}
                  cursor="pointer"
                />
                <Bar
                  dataKey="expense"
                  name="Expense"
                  fill={ct.expense}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive
                  onClick={onBarClick}
                  cursor="pointer"
                />
                <Line
                  dataKey="net"
                  name="Net"
                  stroke={ct.net}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardContent>
            <h3 className="mb-1 text-[20px] font-semibold">Spending</h3>
            <p className="mb-2 text-[13px] text-gray-400">{fmtMonthLabel(monthKey)} by category</p>
            {donut.length === 0 ? (
              <div className="flex h-[260px] items-center justify-center text-sm text-gray-400">No expenses</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={donut}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    isAnimationActive
                    onClick={onSliceClick}
                    cursor="pointer"
                  >
                    {donut.map((d) => (
                      <Cell key={d.id} fill={d.color} stroke={ct.tooltipBg} strokeWidth={2} />
                    ))}
                    <RLabel
                      position="center"
                      content={() => (
                        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                          <tspan x="50%" dy="-0.3em" className="tnum" style={{ fontSize: 20, fontWeight: 700, fill: ct.text }}>
                            {fmtEUR0(donutTotal)}
                          </tspan>
                          <tspan x="50%" dy="1.6em" style={{ fontSize: 11, fill: ct.axis }}>
                            total
                          </tspan>
                        </text>
                      )}
                    />
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtEUR0(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {donut.slice(0, 6).map((d) => (
                <div key={d.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                  {d.name}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* budget vs actual */}
      <Card>
        <CardContent>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[20px] font-semibold">Budget vs actual</h3>
            <button onClick={() => setView("budget")} className="text-[13px] text-accent hover:underline">
              Manage budget →
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {budgetRows
              .filter((r) => r.budget > 0 || r.actual > 0)
              .map((r) => {
                const pct = Math.min(r.pct, 1.5);
                const over = r.status === "over";
                return (
                  <button
                    key={r.id}
                    onClick={() => goToTransactions({ category: r.id, month: monthKey })}
                    className="group text-left"
                  >
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                        {r.name}
                      </span>
                      <span className="tnum text-gray-600">
                        {fmtEUR0(r.actual)} <span className="text-gray-400">/ {fmtEUR0(r.budget)}</span>
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(Math.max(pct, 0), 1) * 100}%`,
                          background: over ? "var(--expense)" : r.color,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


function Metric({
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
      <div className="text-[11px] font-medium text-gray-600 md:text-[12px]">{label}</div>
      <div
        className={cn(
          "tnum text-[22px] font-bold",
          muted && "text-gray-400",
          tone === "income" && !muted && "text-income",
          tone === "expense" && !muted && "text-expense",
        )}
      >
        {fmtEUR0(value)}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  prev,
  positiveUp,
  isPct,
  tintBorder,
}: {
  label: string;
  value: number;
  prev: number;
  positiveUp: boolean;
  isPct?: boolean;
  tintBorder?: boolean;
}) {
  const raw = prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : value !== 0 ? 100 : 0;
  // a partial month against a full one produces deltas like −16,235%, which is
  // arithmetically true and completely unreadable. Cap the display; the arrow
  // and colour still carry the direction.
  const capped = Math.abs(raw) > 999;
  const delta = capped ? Math.sign(raw) * 999 : raw;
  const up = value >= prev;
  const good = positiveUp ? up : !up;
  const display = isPct ? `${Math.round(value * 100)}%` : fmtEUR0(value);

  return (
    <Card
      className={cn(
        tintBorder && (value >= 0 ? "border-income/40" : "border-expense/40"),
      )}
    >
      <CardContent className="p-4 md:p-5">
        <div className="text-[11px] font-medium text-gray-600 md:text-[12px]">{label}</div>
        <div className="tnum mt-1 text-[20px] font-bold leading-tight md:text-[32px]">{display}</div>
        {prev !== 0 && (
          <div className={cn("mt-1 flex items-center gap-1 text-[13px]", good ? "text-income" : "text-expense")}>
            {up ? <ArrowUpRight size={14} strokeWidth={2} /> : <ArrowDownRight size={14} strokeWidth={2} />}
            {capped ? `${delta > 0 ? ">+" : "<−"}999%` : fmtPct(delta)}{" "}
            <span className="hidden text-gray-400 sm:inline">vs last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
