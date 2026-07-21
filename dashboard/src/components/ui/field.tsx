import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-gray-600", className)} {...props} />;
}

const fieldBase =
  "h-9 w-full rounded-[8px] border border-gray-200 bg-paper px-3 text-[13px] text-ink " +
  "placeholder:text-gray-400 " +
  "focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15 " +
  "aria-[invalid=true]:border-expense";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, "tnum transition-colors", className)} {...props} />
  ),
);
Input.displayName = "Input";

/**
 * A select is a *control*, not a field you type into, so it is rendered as a
 * raised key with an explicit chevron.
 *
 * The bare `appearance-none` select it replaced was flat and unmarked — on the
 * transactions filter bar "All categories" and "All accounts" looked like
 * static labels, and there was nothing to suggest they could be opened.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    // className sizes the wrapper (layout), never the <select> — the select
    // always fills it. Putting layout classes on the select instead would leave
    // the absolutely-positioned chevron measuring the wrong box.
    // Default to full width (what every form use wants) unless the caller has
    // already said how wide it should be. Testing for that explicitly beats
    // stacking `w-full` and `w-auto` and hoping Tailwind emits them in the
    // order that makes the override win.
    <span
      className={cn(
        "relative inline-flex",
        !/(^|\s)(w-|flex-1|grow|basis-)/.test(className ?? "") && "w-full",
        className,
      )}
    >
      <select
        ref={ref}
        className={cn(
          fieldBase,
          // border-transparent: .key's rim is an inset ring, so the shared
          // fieldBase border would double it
          "key cursor-pointer appearance-none border-transparent pr-8 font-medium hover:bg-gray-100",
        )}
        {...props}
      />
      <ChevronDown
        size={15}
        strokeWidth={2}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
      />
    </span>
  ),
);
Select.displayName = "Select";
