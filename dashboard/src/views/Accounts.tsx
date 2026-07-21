import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCardWidget } from "@/components/CreditCardWidget";
import { useApp } from "@/app-context";
import {
  accountBalances,
  incomeByChannel,
  netWorth,
  totalCash,
  totalDebt,
  byYear,
} from "@/lib/aggregate";
import { fmtEUR0, fmtMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AccountsView() {
  const { data, monthKey } = useApp();
  const { transactions, accounts, categories, debts } = data;
  const year = monthKey.slice(0, 4);

  const balances = useMemo(
    () => accountBalances(accounts, transactions),
    [accounts, transactions],
  );
  const acctMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const cash = useMemo(() => totalCash(accounts, transactions), [accounts, transactions]);
  const owed = useMemo(
    () => totalDebt(debts, accounts, transactions),
    [debts, accounts, transactions],
  );
  const nw = useMemo(
    () => netWorth(accounts, transactions, debts),
    [accounts, transactions, debts],
  );
  const channelsMonth = useMemo(
    () => incomeByChannel(transactions, categories, monthKey),
    [transactions, categories, monthKey],
  );
  const channelsYtd = useMemo(
    () => incomeByChannel(transactions, categories, null, year),
    [transactions, categories, year],
  );
  const incomeYtd = useMemo(() => byYear(transactions, year).income, [transactions, year]);
  const maxChannel = Math.max(1, ...channelsYtd.map((c) => c.value));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-8">
          <div className="text-[13px] font-medium text-gray-600">Net worth</div>
          <div className={cn("tnum text-[40px] font-bold leading-tight", nw < 0 && "text-expense")}>
            {fmtEUR0(nw)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-gray-400">
            <span>
              Cash <span className="tnum text-ink">{fmtEUR0(cash)}</span> across {accounts.length}{" "}
              accounts
            </span>
            {owed > 0 && (
              <span>
                Owed <span className="tnum text-expense">−{fmtEUR0(owed)}</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <CreditCardWidget />

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[15px] font-semibold">Accounts</h3>
          <span className="text-xs text-gray-400">Summed from transactions</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-5">
                <span className="text-sm font-medium">{a.name}</span>
                {/* Derived, not editable. To change a balance, add the missing
                    transaction — the number here is only ever a sum of rows. */}
                <div className="mt-1">
                  <span
                    className={cn(
                      "tnum text-[24px] font-bold",
                      a.balance < 0 && "text-expense",
                    )}
                  >
                    {fmtEUR0(a.balance)}
                  </span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      acctMap.get(a.id)?.type === "credit" ? "bg-expense" : "bg-accent",
                    )}
                    style={{ width: `${Math.max(0, a.share) * 100}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {/* a credit card is not cash, so a "% of cash" reading on it
                      would be meaningless — it is debt drawn against a limit */}
                  {acctMap.get(a.id)?.type === "credit"
                    ? "credit card · owed"
                    : `${(Math.max(0, a.share) * 100).toFixed(0)}% of cash`}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardContent>
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-[20px] font-semibold">Income sources</h3>
            <span className="text-[13px] text-gray-400">{year} year-to-date</span>
          </div>
          <p className="mb-4 text-[13px] text-gray-400">
            This month ({fmtMonthLabel(monthKey)}) shown inline
          </p>
          {channelsYtd.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              No income recorded yet. Add income via the entry form or import a statement.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {channelsYtd.map((c) => {
                const thisMonth = channelsMonth.find((m) => m.id === c.id)?.value ?? 0;
                return (
                  <div key={c.id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </span>
                      <span className="tnum text-gray-600">
                        {fmtEUR0(c.value)}
                        {thisMonth > 0 && (
                          <span className="text-gray-400"> · {fmtEUR0(thisMonth)} this mo.</span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(c.value / maxChannel) * 100}%`, background: c.color }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="mt-1 flex justify-between border-t border-gray-200 pt-3 text-sm">
                <span className="font-medium">Total income YTD</span>
                <span className="tnum font-semibold text-income">{fmtEUR0(incomeYtd)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
