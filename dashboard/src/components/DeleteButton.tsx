import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

interface Props {
  /** what is being deleted, shown in the confirmation ("Delete Revolut?") */
  label: string;
  /** one line on what deleting actually does, before they commit to it */
  description?: ReactNode;
  onDelete: () => Promise<void>;
  /** shown on success */
  onDeleted?: () => void;
  className?: string;
}

/**
 * Trash icon + a confirmation step, used wherever the dashboard deletes a
 * record the user owns (account, debt, budget item).
 *
 * The server refuses some deletions — an account with transactions on it, a
 * category still in use — and the refusal explains what is in the way. That
 * message is rendered here rather than swallowed into a generic "failed",
 * because it is the only thing that tells the user what to clear first.
 */
export function DeleteButton({ label, description, onDelete, onDeleted, className }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await onDelete();
      setOpen(false);
      onDeleted?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setErr(null);
          setOpen(true);
        }}
        aria-label={`Delete ${label}`}
        title={`Delete ${label}`}
        className={
          "rounded-[8px] p-1.5 text-gray-400 transition-colors hover:bg-expense/10 hover:text-expense " +
          (className ?? "")
        }
      >
        <Trash2 size={15} strokeWidth={1.75} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={`Delete ${label}?`}>
        <div className="flex flex-col gap-4">
          {description && <p className="text-[13px] text-gray-600">{description}</p>}
          {err && (
            <p className="rounded-[8px] bg-expense/10 px-3 py-2 text-[13px] text-expense">{err}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void confirm()} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
