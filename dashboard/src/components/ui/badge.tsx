import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[5px] bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600",
        className,
      )}
      {...props}
    />
  );
}

/** Category tag: colored dot + name, neutral pill. */
export function CategoryTag({ name, color }: { name: string; color: string }) {
  return (
    <Badge>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-ink">{name}</span>
    </Badge>
  );
}
