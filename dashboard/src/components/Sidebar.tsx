import { Banknote, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useApp } from "@/app-context";
import { VIEW_DEFS } from "@/lib/views";
import { cn } from "@/lib/utils";

interface Props {
  /** desktop: icon rail instead of full labels */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** mobile: drawer visibility */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: Props) {
  const { view, setView } = useApp();

  const nav = (
    <nav className="flex flex-col gap-1">
      {VIEW_DEFS.map(({ id, label, Icon, accentVar }) => {
        const active = view === id;
        return (
          <button
            key={id}
            onClick={() => {
              setView(id);
              onCloseMobile();
            }}
            title={collapsed ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-[10px] text-[13px] font-medium",
              // py-2 keeps a ~34px touch target on the mobile drawer; the
              // desktop rail tightens to match the reference's compact rows
              collapsed ? "justify-center px-0 py-2 md:py-1.5" : "px-3 py-2 md:py-1.5",
              // the active item is a pressed-in key, so it wears .key and gets
              // the same lip as every button; inactive items stay flat
              active
                ? "key text-white hover:brightness-115"
                : "text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-ink active:bg-gray-200",
            )}
            // the active pill wears the view's own hue, so the nav doubles as a
            // colour key for which page you are on
            style={active ? { background: `var(${accentVar})` } : undefined}
          >
            <Icon size={18} strokeWidth={1.5} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* ── desktop rail ─────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-gray-200 bg-paper px-3 py-5 md:flex",
          "transition-[width] duration-200 ease-out",
          collapsed ? "w-[68px]" : "w-56",
        )}
      >
        <div className={cn("pb-6", collapsed ? "flex justify-center" : "px-3")}>
          {collapsed ? (
            <Banknote size={20} strokeWidth={1.75} className="text-accent" aria-label="Finance Bro" />
          ) : (
            <div className="flex items-center gap-2">
              <Banknote size={18} strokeWidth={1.75} className="shrink-0 text-accent" />
              <span className="text-[15px] font-semibold tracking-tight">Finance Bro</span>
            </div>
          )}
        </div>

        {nav}

        <button
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mt-auto flex items-center gap-3 rounded-[10px] py-1.5 text-[13px] text-gray-400",
            "transition-colors hover:bg-gray-100 hover:text-ink",
            collapsed ? "justify-center px-0" : "px-3",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} strokeWidth={1.5} />
          ) : (
            <>
              <PanelLeftClose size={18} strokeWidth={1.5} />
              <span>Collapse</span>
            </>
          )}
        </button>
      </aside>

      {/* ── mobile drawer ────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-[2px]"
            onClick={onCloseMobile}
          />
          <aside className="pt-safe pb-safe absolute inset-y-0 left-0 flex w-[78%] max-w-[280px] animate-slide-in-left flex-col border-r border-gray-200 bg-paper px-3 [--pb:1.25rem] [--pt:1.25rem] shadow-modal">
            <div className="mb-4 flex items-center justify-between px-3">
              <div className="flex items-center gap-2">
                <Banknote size={18} strokeWidth={1.75} className="shrink-0 text-accent" />
                <span className="text-[15px] font-semibold tracking-tight">Finance Bro</span>
              </div>
              <button
                onClick={onCloseMobile}
                aria-label="Close menu"
                className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-ink"
              >
                <X size={20} strokeWidth={1.5} />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
