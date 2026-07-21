import { ChevronLeft, ChevronRight, Menu, Plus } from "lucide-react";
import { useApp } from "@/app-context";
import { Button } from "@/components/ui/button";
import { ThemeControls } from "@/components/ThemeControls";
import { VIEW_BY_ID } from "@/lib/views";
import { fmtMonthLabel, todayKey } from "@/lib/format";
import { monthList, prevMonth } from "@/lib/aggregate";

function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { monthKey, setMonthKey, data, openAddEntry, view } = useApp();
  const today = todayKey();

  // available months: earliest tx → current month
  const earliest = data.transactions.reduce(
    (min, t) => (t.date.slice(0, 7) < min ? t.date.slice(0, 7) : min),
    today,
  );
  const [ey, em] = earliest.split("-").map(Number);
  const [cy, cm] = today.split("-").map(Number);
  const span = (cy - ey) * 12 + (cm - em) + 1;
  const months = monthList(today, Math.max(span, 1)).reverse(); // newest first

  const atFuture = monthKey >= today;
  const title = VIEW_BY_ID.get(view)?.label ?? "";

  return (
    // solid bg, not bg-paper/85: translucent over the darker --bg-app canvas
    // resolved to a shade that didn't match the solid sidebar, so the header
    // read as a faintly discoloured panel rather than one continuous surface
    <header className="pt-safe sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-gray-200 bg-paper px-4 pb-4 [--pt:1rem] md:px-8 md:pb-5 md:[--pt:1.25rem]">
      <div className="flex min-w-0 items-center gap-1">
        {/* mobile: menu button + page name stand in for the desktop month stepper */}
        <button
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="-ml-1 rounded-[10px] p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-ink active:bg-gray-200 md:hidden"
        >
          <Menu size={20} strokeWidth={1.5} />
        </button>
        <span className="truncate text-[15px] font-semibold md:hidden">{title}</span>

        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          onClick={() => setMonthKey(prevMonth(monthKey))}
          aria-label="Previous month"
        >
          <ChevronLeft size={18} strokeWidth={1.5} />
        </Button>
        <select
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value)}
          aria-label="Month"
          className="key hidden cursor-pointer appearance-none rounded-[10px] bg-paper px-3 py-1.5 text-[14px] font-semibold hover:bg-gray-100 focus:outline-none md:block"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonthLabel(m)}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          onClick={() => !atFuture && setMonthKey(nextMonth(monthKey))}
          disabled={atFuture}
          aria-label="Next month"
        >
          <ChevronRight size={18} strokeWidth={1.5} />
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        {/* compact month picker for mobile, where the stepper doesn't fit */}
        <select
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value)}
          aria-label="Month"
          className="key cursor-pointer appearance-none rounded-[10px] bg-paper px-2.5 py-1.5 text-[13px] font-medium focus:outline-none md:hidden"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonthLabel(m)}
            </option>
          ))}
        </select>

        <ThemeControls />

        {/* stays burgundy on every page: it's the app's one constant action, so
            recolouring it per view made the primary CTA look like it changed
            meaning between pages */}
        <Button variant="primary" onClick={() => openAddEntry()} className="px-3 md:px-5">
          <Plus size={16} strokeWidth={2} />
          <span className="hidden sm:inline">Add entry</span>
        </Button>
      </div>
    </header>
  );
}
