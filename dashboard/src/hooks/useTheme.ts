import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "os-theme";

/**
 * Light / dark / system only.
 *
 * The runtime accent picker was removed — the accent is fixed burgundy
 * (#931037, encoded as --accent-h/s/l in index.css) and each view layers its
 * own brand hue on top via --view-accent. Nothing here writes colour any more,
 * so the anti-flash script in index.html no longer parses a stored hex either.
 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(THEME_KEY) as ThemeMode) || "system",
  );

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    localStorage.setItem(THEME_KEY, mode);
  }, [mode]);

  const cycleMode = useCallback(() => {
    setMode((m) => (m === "light" ? "dark" : m === "dark" ? "system" : "light"));
  }, []);

  return { mode, setMode, cycleMode };
}
