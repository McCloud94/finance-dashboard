import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/button";

/**
 * Light / dark / system toggle.
 *
 * The accent-colour picker that used to live here was removed deliberately: the
 * accent is load-bearing (active nav, planned rows, needs-review chips) and each
 * view now carries its own hue, so swapping it at runtime only broke those
 * relationships. The accent is brand, not preference.
 */
export function ThemeControls() {
  const { mode, cycleMode } = useTheme();
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;

  return (
    <Button variant="ghost" size="icon" onClick={cycleMode} aria-label={`Theme: ${mode}`}>
      <Icon size={18} strokeWidth={1.5} />
    </Button>
  );
}
