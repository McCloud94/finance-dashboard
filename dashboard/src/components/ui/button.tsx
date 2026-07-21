import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "accent";
type Size = "sm" | "md" | "lg" | "icon";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * Raised-key buttons.
 *
 * The 3D comes from the hard, unblurred bottom lip in --shadow-btn, not from a
 * soft drop shadow — see the note there. Hover lightens the top face only
 * (brightness), which reads as the key catching more light; the lip stays put
 * so the key doesn't appear to grow. :active is handled by .key: the lip
 * collapses and the whole button translates down by exactly the lip height.
 */
const variants: Record<Variant, string> = {
  // filled burgundy — the app's one high-emphasis action
  primary: "bg-accent text-white hover:brightness-115",
  // per-page accent — recolours with the active view
  accent: "bg-view text-white hover:brightness-115",
  // raised neutral key — the default for secondary actions. No border class:
  // the hairline rim is the last inset layer of --shadow-btn, so adding one
  // here would draw a second line just outside it.
  secondary: "bg-paper text-ink hover:bg-gray-100",
  // flat until touched — deliberately gets no .key lip, so it reads as a hint
  // rather than a key and never competes with a real action next to it
  ghost:
    "bg-transparent text-gray-600 transition-colors duration-150 " +
    "hover:bg-gray-100 hover:text-ink active:bg-gray-200",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px]",
  md: "h-9 px-4 text-[13px]",
  // comfortable thumb target on mobile
  lg: "h-11 px-5 text-[15px]",
  icon: "h-9 w-9",
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-view",
        "disabled:pointer-events-none disabled:opacity-50",
        variant !== "ghost" && "key",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
