import {
  ArrowLeftRight,
  CalendarDays,
  LayoutDashboard,
  Landmark,
  Target,
  Wallet,
} from "lucide-react";
import type { ViewId } from "@/app-context";

/**
 * One definition per route: label, icon, and the accent that page wears.
 *
 * The accent is a CSS custom-property name rather than a hex value so each
 * colour still resolves per theme — the brand hues lighten in dark mode, and a
 * hardcoded hex here would opt the nav out of that.
 *
 * Overview keeps the burgundy --accent because it is the app's home surface;
 * the other five take a brand hue. Debt is red and Budget green deliberately:
 * those pages are *about* the thing the colour already means elsewhere, so the
 * semantics reinforce rather than fight.
 */
export interface ViewDef {
  id: ViewId;
  label: string;
  Icon: typeof LayoutDashboard;
  /** custom property holding this view's accent */
  accentVar: string;
}

export const VIEW_DEFS: ViewDef[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard, accentVar: "--accent" },
  { id: "accounts", label: "Accounts", Icon: Wallet, accentVar: "--brand-blue" },
  { id: "transactions", label: "Transactions", Icon: ArrowLeftRight, accentVar: "--brand-amber" },
  { id: "debt", label: "Debt", Icon: Landmark, accentVar: "--brand-red" },
  { id: "budget", label: "Budget", Icon: Target, accentVar: "--brand-green" },
  { id: "calendar", label: "Calendar", Icon: CalendarDays, accentVar: "--brand-blue" },
];

export const VIEW_BY_ID = new Map(VIEW_DEFS.map((v) => [v.id, v]));

/**
 * Point --view-accent at the active route's hue.
 *
 * Everything themed per-page (`bg-view`, `text-view`, focus rings) reads that
 * one property, so a route change recolours the UI without any component
 * needing to know which view is active.
 */
export function applyViewAccent(view: ViewId) {
  const def = VIEW_BY_ID.get(view);
  const root = document.documentElement;
  const v = def?.accentVar ?? "--accent";
  root.style.setProperty("--view-accent", `var(${v})`);
  root.style.setProperty("--view-accent-soft", `color-mix(in srgb, var(${v}) 14%, transparent)`);
}
