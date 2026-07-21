import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Pencil, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Badge, CategoryTag } from "@/components/ui/badge";
import { TxDetailDrawer } from "@/components/TxDetailDrawer";
import { EmptyState } from "@/components/States";
import { useApp } from "@/app-context";
import { fmtEUR, fmtMonthLabel, monthKeyOf } from "@/lib/format";
import { cn } from "@/lib/utils";

type DirFilter = "all" | "income" | "expense" | "internal";

interface Props {
  initialFilter: { category?: string; month?: string };
  clearInitialFilter: () => void;
}

export function TransactionsView({ initialFilter, clearInitialFilter }: Props) {
  const { data, monthKey, setMonthKey } = useApp();
  const { transactions, categories, accounts } = data;

  /**
   * The month comes from the TopBar selector, not from local state.
   *
   * This view used to hold its own `month`, initialised to "" and only ever
   * written by a click-through from another view. So the header could read
   * "Jun 2026" while the table listed every transaction ever imported — the
   * selector appeared broken because nothing here was reading it.
   *
   * `allMonths` is the deliberate escape hatch: clearing the month chip widens
   * the view to the full history rather than silently desyncing from the header.
   */
  const [allMonths, setAllMonths] = useState(false);
  const month = allMonths ? "" : monthKey;

  const [category, setCategory] = useState<string>(initialFilter.category ?? "");
  const [account, setAccount] = useState<string>("");
  const [dir, setDir] = useState<DirFilter>("all");
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  // hold the id, not the row: an edit replaces the object in `data`, and a
  // captured copy would leave the open drawer showing pre-edit values.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => transactions.find((t) => t.id === selectedId) ?? null,
    [transactions, selectedId],
  );

  // apply incoming filter from click-through, then clear it so manual edits stick
  useEffect(() => {
    if (initialFilter.month) {
      // drive the shared selector, so the header and the table agree
      setMonthKey(initialFilter.month);
      setAllMonths(false);
    }
    if (initialFilter.category) setCategory(initialFilter.category);
    if (initialFilter.month || initialFilter.category) clearInitialFilter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilter]);

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw.toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [searchRaw]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const acctMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const rows = useMemo(() => {
    return transactions
      .filter((t) => (month ? monthKeyOf(t.date) === month : true))
      .filter((t) => (category ? (t.category ?? "") === category : true))
      .filter((t) => (account ? t.account === account : true))
      .filter((t) => (dir === "all" ? true : t.direction === dir))
      // an expense/income row with no category is an import the rules couldn't
      // place — this is the queue to clear via the drawer
      .filter((t) => (needsReview ? !t.category && t.direction !== "internal" : true))
      .filter((t) =>
        search ? `${t.name} ${t.merchant ?? ""}`.toLowerCase().includes(search) : true,
      )
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [transactions, month, category, account, dir, search, needsReview]);

  const reviewCount = useMemo(
    () => transactions.filter((t) => !t.category && t.direction !== "internal").length,
    [transactions],
  );

  const activeChips: { label: string; clear: () => void }[] = [];
  if (month) activeChips.push({ label: fmtMonthLabel(month), clear: () => setAllMonths(true) });
  if (category) activeChips.push({ label: catMap.get(category)?.name ?? category, clear: () => setCategory("") });
  if (account) activeChips.push({ label: acctMap.get(account)?.name ?? account, clear: () => setAccount("") });
  if (dir !== "all") activeChips.push({ label: dir, clear: () => setDir("all") });
  // when the month filter is off, say so — otherwise the header shows a month
  // the table is ignoring, which is what made the selector look broken
  if (allMonths)
    activeChips.push({ label: "All months", clear: () => setAllMonths(false) });

  return (
    <div className="flex flex-col gap-4">
      {/* filter bar */}
      <Card className="p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* search takes its own row on mobile, then shares one with the
              selects from md up — squeezing all three onto a phone row cut the
              select labels down to a single letter */}
          <div className="relative basis-full md:min-w-[200px] md:flex-1 md:basis-auto">
            <Search size={16} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              className="pl-9"
              placeholder="Search name or merchant…"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
            />
          </div>
          <Select className="basis-full md:w-auto md:flex-none md:basis-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select className="basis-full md:w-auto md:flex-none md:basis-auto" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          {/* segmented control: a recessed track with the selected option
              standing up out of it as a key, so the current choice is legible
              from the elevation alone */}
          <div className="flex h-9 items-center gap-1 rounded-[10px] bg-gray-100 p-1">
            {(["all", "income", "expense", "internal"] as DirFilter[]).map((d) => (
              <button
                key={d}
                onClick={() => setDir(d)}
                aria-pressed={dir === d}
                className={cn(
                  "rounded-[7px] px-2.5 py-1 text-[12px] capitalize",
                  dir === d
                    ? "key bg-paper font-medium text-ink hover:brightness-105"
                    : "text-gray-600 transition-colors hover:text-ink",
                )}
              >
                {d}
              </button>
            ))}
          </div>
          {reviewCount > 0 && (
            <button
              onClick={() => setNeedsReview((v) => !v)}
              aria-pressed={needsReview}
              className={cn(
                "key flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px]",
                needsReview
                  ? "bg-accent text-white hover:brightness-115"
                  : "bg-paper text-gray-600 hover:bg-gray-100 hover:text-ink",
              )}
            >
              Needs review
              <span
                className={cn(
                  "tnum rounded-full px-1.5 text-xs",
                  needsReview ? "bg-white/25" : "bg-gray-100",
                )}
              >
                {reviewCount}
              </span>
            </button>
          )}
        </div>
        {activeChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeChips.map((chip, i) => (
              <button
                key={i}
                onClick={chip.clear}
                className="key flex items-center gap-1.5 rounded-[7px] bg-accent-light px-2.5 py-1 text-xs font-medium text-accent hover:brightness-105"
              >
                {chip.label}
                <X size={12} strokeWidth={2} />
              </button>
            ))}
            <button
              onClick={() => {
                setAllMonths(false);
                setCategory("");
                setAccount("");
                setDir("all");
                setSearchRaw("");
              }}
              className="ml-1 text-xs text-gray-400 transition-colors hover:text-ink"
            >
              Clear all
            </button>
          </div>
        )}
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="No transactions match"
          hint="Adjust filters, or drop a bank export into Statements/ and run: python3 normalize.py && python3 import_csv.py"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-100 text-left text-xs font-medium text-gray-600">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const cat = t.category ? catMap.get(t.category) : undefined;
                  const internal = t.direction === "internal";
                  // a refund is an expense row that gives money back — it reads as a credit
                  const income = t.direction === "income" || t.refund;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={cn(
                        "cursor-pointer border-b border-gray-200 transition-colors last:border-0 hover:bg-gray-100",
                        t.planned && "opacity-70",
                      )}
                    >
                      <td className="tnum whitespace-nowrap px-4 py-3 text-gray-600">{t.date}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 font-content">
                          {t.name}
                          {/* `planned` is a real boolean now (coerced in Store.snapshot).
                              When it was SQLite's integer 0, `0 && <Badge/>` rendered a
                              literal "0" after every name. */}
                          {t.planned && <Badge className="bg-accent-light text-accent">Planned</Badge>}
                          {t.edited && (
                            <Pencil size={11} strokeWidth={2} className="text-accent" aria-label="edited" />
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {cat ? (
                          <CategoryTag name={cat.name} color={cat.color} />
                        ) : internal ? (
                          <Badge className="text-gray-400">transfer</Badge>
                        ) : (
                          <Badge className="bg-accent-light text-accent">needs review</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {acctMap.get(t.account)?.name ?? t.account}
                        {internal && t.transfer_to && (
                          <span className="text-gray-400">
                            {" → "}
                            {acctMap.get(t.transfer_to)?.name ?? t.transfer_to}
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "tnum whitespace-nowrap px-4 py-3 text-right text-[17px] font-medium",
                          internal ? "text-gray-400" : income ? "text-income" : "text-expense",
                        )}
                      >
                        <span className="inline-flex items-center justify-end gap-1">
                          {internal ? (
                            <ArrowRightLeft size={13} strokeWidth={2} />
                          ) : income ? (
                            <ArrowDownLeft size={13} strokeWidth={2} />
                          ) : (
                            <ArrowUpRight size={13} strokeWidth={2} />
                          )}
                          {internal ? "" : income ? "+" : "−"}
                          {fmtEUR(t.amount)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* mobile: the 5-column table is unreadable under ~700px, so each row
              becomes a two-line card with the amount right-aligned */}
          <ul className="divide-y divide-gray-200 md:hidden">
            {rows.map((t) => {
              const cat = t.category ? catMap.get(t.category) : undefined;
              const internal = t.direction === "internal";
              const income = t.direction === "income" || t.refund;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-gray-100",
                      t.planned && "opacity-70",
                    )}
                  >
                    <span
                      className="h-8 w-8 shrink-0 rounded-full"
                      style={{
                        background: cat
                          ? `color-mix(in srgb, ${cat.color} 18%, transparent)`
                          : "var(--bg-subtle)",
                      }}
                    >
                      <span className="flex h-full w-full items-center justify-center">
                        {internal ? (
                          <ArrowRightLeft size={13} strokeWidth={2} className="text-gray-400" />
                        ) : income ? (
                          <ArrowDownLeft size={13} strokeWidth={2} className="text-income" />
                        ) : (
                          <ArrowUpRight size={13} strokeWidth={2} className="text-expense" />
                        )}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-content text-sm">{t.name}</span>
                        {t.edited && <Pencil size={10} strokeWidth={2} className="shrink-0 text-accent" />}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
                        <span className="tnum">{t.date.slice(5)}</span>
                        <span>·</span>
                        <span className="truncate">{cat?.name ?? (internal ? "transfer" : "needs review")}</span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        "tnum shrink-0 text-[17px] font-medium",
                        internal ? "text-gray-400" : income ? "text-income" : "text-expense",
                      )}
                    >
                      {internal ? "" : income ? "+" : "−"}
                      {fmtEUR(t.amount)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-400">
            {rows.length} transaction{rows.length === 1 ? "" : "s"}
          </div>
        </Card>
      )}

      <TxDetailDrawer tx={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
