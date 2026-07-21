import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** "dialog" = centered modal, "sheet" = right-side drawer */
  variant?: "dialog" | "sheet";
}

export function Modal({ open, onClose, title, children, variant = "dialog" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const panel =
    variant === "sheet"
      ? // full-height side sheet on desktop; on mobile it docks to the bottom
        // as a sheet, which is where a thumb can actually reach the controls
        "mt-auto h-[88dvh] w-full rounded-t-[18px] animate-pop-in sm:ml-auto sm:mt-0 sm:h-full " +
        "sm:max-w-md sm:rounded-l-[16px] sm:rounded-tr-none sm:animate-slide-in-right shadow-modal"
      : "mt-auto w-full rounded-t-[18px] animate-pop-in sm:m-auto sm:max-w-lg sm:rounded-[16px] shadow-modal";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in bg-black/40 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={cn("pb-safe flex max-h-full flex-col overflow-hidden bg-paper", panel)}>
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-[18px] font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-ink"
            aria-label="Close"
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
