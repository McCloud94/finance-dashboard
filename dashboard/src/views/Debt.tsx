import { useMemo } from "react";
import { HandCoins, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCardWidget } from "@/components/CreditCardWidget";
import { EmptyState } from "@/components/States";
import { useApp } from "@/app-context";
import { totalCash, totalDebt } from "@/lib/aggregate";
import { fmtEUR0 } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Debt } from "@/types";

function DebtRow({ d, max }: { d: Debt; max: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="flex items-center gap-2">
          {d.name}
          {d.counterparty && <span className="text-[13px] text-gray-400">{d.counterparty}</span>}
        </span>
        <span className="tnum font-medium">{fmtEUR0(d.balance)}</span>
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
      <EmptyState
        title="No debts tracked"
        hint="Add entries to data/debts.json and run: python3 init_db.py"
      />
    );
  }

  // How much of what you owe you could clear right now. The honest version of
  // "am I actually in the hole" — a big cash balance means very little if the
  // card is maxed and the family loans are outstanding.
  const coverage = owed > 0 ? cash / owed : 1;

  return (
    <div className="flex flex-col gap-4">
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
              Family loans
            </h3>
            <p className="mb-4 text-[13px] text-gray-400">
              Received as income and recorded here — these are to be returned.
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
    </div>
  );
}
