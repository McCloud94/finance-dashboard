import { cn } from "@/lib/utils";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}

export function Switch({ checked, onChange, id }: Props) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        checked ? "bg-ink" : "bg-gray-200",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-paper shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
