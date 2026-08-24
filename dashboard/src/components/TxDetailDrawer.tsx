import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Check, Loader2, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { useApp } from "@/app-context";
import type { Transaction } from "@/types";
import { fmtEUR, todayDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  tx: Transaction | null;
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 border-b border-gray-200 py-2.5 last:border-0">
      <span className="shrink-0 text-[13px] text-gray-600">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/**
 * Text/number cell that commits on blur or Enter and reverts on Escape.
 *
 * Held in local state while focused rather than driven straight from `tx`:
 * saving on every keystroke would fire a PATCH per character, and each response
 * replaces the row object in `data`, which would yank the cursor mid-word.
 */
function EditableField({
  value,
  onCommit,
  type = "text",
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  type?: "text" | "number" | "date";
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  // pick up external changes (another edit, a reload) only while not typing
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  return (
    <Input
      type={type}
      step={type === "number" ? "0.01" : undefined}
      className={cn("h-9", className)}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

type SaveState = "idle" | "saving" | "saved";

export function TxDetailDrawer({ tx, onClose }: Props) {
  const { data, updateTransaction, deleteTransaction } = useApp();
  const { categories, accounts } = data;
  const [state, setState] = useState<SaveState>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setState("idle");
    setErr(null);
    setConfirmDelete(false);
  }, [tx?.id]);

  if (!tx) return null;
  const internal = tx.direction === "internal";
  // a refund is an expense row that gives money back, so it reads as a credit
  const income = tx.direction === "income" || tx.refund;

  // Only categories matching the row's direction are offerable — the server
  // enforces this too, so showing the others would just surface a 400.
  const catOptions = categories.filter((c) => c.type === tx.direction);

  async function save(fields: Parameters<typeof updateTransaction>[1]) {
    if (!tx) return;
    setErr(null);
    setState("saving");
    try {
      await updateTransaction(tx.id, fields);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (e) {
      setState("idle");
      setErr(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function remove() {
    if (!tx) return;
    setErr(null);
    setState("saving");
    try {
      await deleteTransaction(tx.id);
      onClose();
    } catch (e) {
      setState("idle");
      setErr(e instanceof Error ? e.message : "Could not delete.");
    }
  }

  const icon = internal ? (
    <ArrowRightLeft size={20} strokeWidth={1.5} />
  ) : income ? (
    <ArrowDownLeft size={20} strokeWidth={1.5} />
  ) : (
    <ArrowUpRight size={20} strokeWidth={1.5} />
  );

  return (
    <Modal open={!!tx} onClose={onClose} title={tx.name} variant="sheet">
      <div className="flex flex-col gap-1">
        <div className="mb-4 flex items-center gap-3">
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full",
              internal
                ? "bg-gray-100 text-gray-600"
                : income
                  ? "bg-income/10 text-income"
                  : "bg-expense/10 text-expense",
            )}
          >
            {icon}
          </span>
          <div
            className={cn(
              "tnum text-[28px] font-bold",
              internal ? "text-gray-600" : income ? "text-income" : "text-expense",
            )}
          >
            {internal ? "" : income ? "+" : "−"}
            {fmtEUR(tx.amount)}
          </div>
          {tx.edited && (
            <Badge className="ml-auto bg-accent-light text-accent">Edited</Badge>
          )}
        </div>

        <Row label="Name">
          <EditableField
            value={tx.name}
            onCommit={(v) => save({ name: v.trim() })}
            className="w-[220px]"
          />
        </Row>

        <Row label="Amount (€)">
          {/* always positive — the sign comes from direction / flow / refund */}
          <EditableField
            type="number"
            value={String(tx.amount)}
            onCommit={(v) => save({ amount: Number(v) })}
            className="w-[120px] tnum"
          />
        </Row>

        <Row label="Date">
          <EditableField
            type="date"
            value={tx.date}
            onCommit={(v) => save({ date: v })}
            className="w-[160px]"
          />
        </Row>

        <Row label="Direction">
          <Select
            className="w-[180px]"
            value={tx.direction}
            onChange={(e) => save({ direction: e.target.value as Transaction["direction"] })}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="internal">Internal transfer</option>
          </Select>
        </Row>

        {internal && (
          <Row label="Money">
            {/* Both legs of a transfer are direction 'internal'. This is the
                only field carrying the sign — an internal row without it
                contributes nothing to the account balance. */}
            <Select
              className="w-[180px]"
              value={tx.flow ?? ""}
              onChange={(e) => save({ flow: e.target.value as "in" | "out" })}
            >
              <option value="" disabled>
                Pick one
              </option>
              <option value="in">In — money arrived</option>
              <option value="out">Out — money left</option>
            </Select>
          </Row>
        )}

        {tx.direction === "expense" && (
          <Row label="Refund">
            <label className="flex items-center gap-2 text-[13px] text-gray-600">
              <input
                type="checkbox"
                checked={tx.refund}
                onChange={(e) => save({ refund: e.target.checked })}
                className="accent-accent"
              />
              Money back — subtracts from this category
            </label>
          </Row>
        )}

        <Row label="Category">
          {internal ? (
            <span className="text-gray-400">— transfers have no category</span>
          ) : (
            <Select
              className="w-[180px]"
              value={tx.category ?? ""}
              onChange={(e) => save({ category: e.target.value || null })}
            >
              <option value="">Uncategorized</option>
              {catOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Row>

        <Row label="Account">
          <Select
            className="w-[180px]"
            value={tx.account}
            onChange={(e) => save({ account: e.target.value })}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Row>

        {internal && (
          <Row label="Transfer to">
            <Select
              className="w-[180px]"
              value={tx.transfer_to ?? ""}
              onChange={(e) => save({ transfer_to: e.target.value || null })}
            >
              <option value="">Unknown</option>
              {accounts
                .filter((a) => a.id !== tx.account)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Row>
        )}

        <Row label="Raw merchant">
          <EditableField
            value={tx.merchant ?? ""}
            onCommit={(v) => save({ merchant: v.trim() || null })}
            className="w-[220px]"
          />
        </Row>

        <Row label="Note">
          <EditableField
            value={tx.note ?? ""}
            onCommit={(v) => save({ note: v.trim() || null })}
            className="w-[220px]"
          />
        </Row>

        <Row label="Source">
          <Badge>{tx.source ?? "—"}</Badge>
        </Row>

        {/* Imported rows are the bank's record of money that already moved, so
            they are never plans — the server rejects the flip and there is
            nothing to offer here. */}
        {tx.source === "manual" && (
          <Row label="Status">
            {/* Ticked means it happened, so the box is bound to !planned: a real
                entry reads as checked, and unticking it is the act of pushing it
                back to a plan. The label follows the state rather than naming
                what a click would assert. */}
            <label className="flex items-center gap-2 text-[13px] text-gray-600">
              <input
                type="checkbox"
                checked={!tx.planned}
                onChange={(e) => save({ planned: !e.target.checked })}
                className="accent-accent"
              />
              {tx.planned ? "Planned — not counted yet" : "Happened — counts as real"}
            </label>
          </Row>
        )}

        {tx.source === "manual" && tx.planned && tx.date <= todayDate() && (
          <p className="-mt-1 pb-2 text-xs text-gray-400">
            Its date has passed and it is still planned, so it stays that way until you
            say otherwise. Move the date forward to have it settle on its own again.
          </p>
        )}

        <Row label="ID">
          <span className="tnum break-all text-xs text-gray-400">{tx.id}</span>
        </Row>

        <div className="mt-3 flex min-h-[20px] items-center gap-1.5 text-[13px]">
          {state === "saving" && (
            <span className="flex items-center gap-1.5 text-gray-400">
              <Loader2 size={13} className="animate-spin" strokeWidth={2} /> Saving…
            </span>
          )}
          {state === "saved" && (
            <span className="flex items-center gap-1.5 text-income">
              <Check size={13} strokeWidth={2} /> Saved — survives the next import
            </span>
          )}
          {err && <span className="text-expense">{err}</span>}
        </div>

        {tx.edited && !err && state === "idle" && (
          <p className="text-xs text-gray-400">
            This row has dashboard edits layered over the imported data. Setting a field back
            to its imported value removes the override.
          </p>
        )}

        <div className="mt-4 border-t border-gray-200 pt-4">
          {confirmDelete ? (
            <div className="flex flex-col gap-2">
              <p className="text-[13px]">
                Delete this transaction?{" "}
                {tx.source === "manual" ? (
                  <span className="text-gray-400">It was added by hand and will be gone for good.</span>
                ) : (
                  <span className="text-gray-400">
                    It came from a statement, so it is also recorded as deleted — re-importing
                    will not bring it back.
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void remove()}
                  disabled={state === "saving"}
                  className="bg-expense hover:bg-expense/90"
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-[13px] text-gray-400 transition-colors hover:text-expense"
            >
              <Trash2 size={13} strokeWidth={2} />
              Delete transaction
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
