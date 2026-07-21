import { useCallback, useEffect, useState } from "react";

/**
 * Resolved colours for Recharts.
 *
 * Recharts writes colours into SVG attributes (`fill`, `stroke`) rather than
 * CSS, so `var(--brand-blue)` does not work there — the value has to be a real
 * colour string at render time. This reads the computed custom properties off
 * <html> and re-reads them whenever the theme changes, which keeps one source
 * of truth in index.css instead of a second hardcoded palette in the charts.
 *
 * Before this existed the charts used literal `#e5e5e5` / `#666` / `#fff`, so
 * grid lines, axis labels and tooltips stayed light-mode coloured on the dark
 * canvas — effectively invisible.
 */
export interface ChartTheme {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  text: string;
  income: string;
  expense: string;
  net: string;
  amber: string;
  blue: string;
  red: string;
  green: string;
  accent: string;
  /** category donut/bar series, in draw order */
  series: string[];
}

function read(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  const amber = v("--brand-amber");
  const blue = v("--brand-blue");
  const red = v("--brand-red");
  const green = v("--brand-green");
  const accent = v("--accent");
  return {
    grid: v("--border"),
    axis: v("--text-faint"),
    tooltipBg: v("--bg-primary"),
    tooltipBorder: v("--border"),
    text: v("--text-normal"),
    income: v("--income"),
    expense: v("--expense"),
    net: blue,
    amber,
    blue,
    red,
    green,
    accent,
    series: [blue, amber, green, red, accent],
  };
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(read);
  const refresh = useCallback(() => setTheme(read()), []);

  useEffect(() => {
    // explicit toggle: data-theme flips on <html>
    const obs = new MutationObserver(refresh);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // "system" mode: no attribute changes, so watch the OS query too
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", refresh);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", refresh);
    };
  }, [refresh]);

  return theme;
}
