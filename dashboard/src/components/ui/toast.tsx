import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

interface Toast {
  id: number;
  msg: string;
}

const ToastCtx = createContext<(msg: string) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-[10px] border border-gray-200 bg-paper px-4 py-3 text-sm shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-income/15 text-income">
                <Check size={14} strokeWidth={2} />
              </span>
              {t.msg}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
