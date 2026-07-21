import { useCallback, useEffect, useState } from "react";
import { useData, type NewEntry } from "@/hooks/useData";
import { AppContext, type ViewId } from "@/app-context";
import { todayKey } from "@/lib/format";
import { applyViewAccent } from "@/lib/views";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { AddEntryDialog } from "@/components/AddEntryDialog";
import { OverviewView } from "@/views/Overview";
import { AccountsView } from "@/views/Accounts";
import { TransactionsView } from "@/views/Transactions";
import { DebtView } from "@/views/Debt";
import { BudgetView } from "@/views/Budget";
import { CalendarView } from "@/views/Calendar";
import { ServerDown, Loading } from "@/components/States";

const VIEWS: ViewId[] = ["overview", "accounts", "transactions", "debt", "budget", "calendar"];
const RAIL_KEY = "os-sidebar-collapsed";

function readHash(): ViewId {
  const h = window.location.hash.replace(/^#\//, "") as ViewId;
  return VIEWS.includes(h) ? h : "overview";
}

export default function App() {
  const {
    data, loading, error, addEntry, updateTransaction, deleteTransaction, updateDebt, updateBudget,
  } = useData();
  const [view, setViewState] = useState<ViewId>(readHash);
  const [monthKey, setMonthKey] = useState<string>(() => {
    const m = new URLSearchParams(window.location.search).get("m");
    return m ?? todayKey();
  });
  const [dialog, setDialog] = useState<{ open: boolean; prefill?: Partial<NewEntry> }>({ open: false });
  const [txFilter, setTxFilter] = useState<{ category?: string; month?: string }>({});
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(RAIL_KEY) === "1");
  const [menuOpen, setMenuOpen] = useState(false);

  // hash routing
  useEffect(() => {
    const onHash = () => setViewState(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // repaint --view-accent whenever the route changes, so every `bg-view` /
  // `text-view` in the tree follows the active page's hue
  useEffect(() => {
    applyViewAccent(view);
  }, [view]);

  useEffect(() => {
    localStorage.setItem(RAIL_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const setView = useCallback((v: ViewId) => {
    window.location.hash = `#/${v}`;
  }, []);

  const openAddEntry = useCallback((prefill?: Partial<NewEntry>) => {
    setDialog({ open: true, prefill });
  }, []);

  const goToTransactions = useCallback(
    (filter?: { category?: string; month?: string }) => {
      setTxFilter(filter ?? {});
      setView("transactions");
    },
    [setView],
  );

  if (loading) return <Loading />;
  if (error || !data) return <ServerDown message={error ?? "No data"} />;

  return (
    <AppContext.Provider
      value={{
        data, monthKey, setMonthKey, view, setView, openAddEntry, goToTransactions,
        addEntry, updateTransaction, deleteTransaction, updateDebt, updateBudget,
      }}
    >
      <div className="flex h-dvh overflow-hidden">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          mobileOpen={menuOpen}
          onCloseMobile={() => setMenuOpen(false)}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onOpenMenu={() => setMenuOpen(true)} />
          <main className="pb-safe flex-1 overflow-y-auto px-4 pt-4 [--pb:1rem] md:px-8 md:pt-8 md:[--pb:2rem]">
            {/* keyed on the route so each page mounts fresh and plays its
                entrance — without the key React reuses the subtree and the
                animation only ever runs once, on first load */}
            <div key={view} className="animate-rise-in">
              {view === "overview" && <OverviewView />}
              {view === "accounts" && <AccountsView />}
              {view === "transactions" && (
                <TransactionsView initialFilter={txFilter} clearInitialFilter={() => setTxFilter({})} />
              )}
              {view === "debt" && <DebtView />}
              {view === "budget" && <BudgetView />}
              {view === "calendar" && <CalendarView />}
            </div>
          </main>
        </div>
      </div>

      <AddEntryDialog
        open={dialog.open}
        onClose={() => setDialog({ open: false })}
        prefill={dialog.prefill}
        categories={data.categories}
        accounts={data.accounts}
        addEntry={addEntry}
      />
    </AppContext.Provider>
  );
}
