import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useApp } from "@/app-context";
import type { CategoryType } from "@/types";

/** Picked round-robin so a new item is distinguishable on the charts without
 *  asking a non-technical user for a hex code. */
const PALETTE = [
  "#37b05f", "#3b7197", "#cd9a3b", "#931037", "#5a93b8",
  "#b1483c", "#e0b96b", "#6bc98a", "#8a7f70", "#a97a28",
];

/**
 * A "budget item" is a category with a monthly limit — the limit is stored
 * against the category, so there is nothing to budget until the category
 * exists. This dialog creates both in one step.
 */
export function AddBudgetItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addCategory, data } = useApp();
  const [name, setName] = useState("");
  const [type, setType] = useState<CategoryType>("expense");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("expense");
    setLimit("");
    setErr(null);
  }, [open]);

  async function submit() {
    setErr(null);
    if (!name.trim()) return setErr("Name is required.");
    const raw = limit.trim();
    const n = raw === "" ? null : Number(raw);
    if (n !== null && !(n >= 0)) return setErr("Monthly limit must be 0 or more.");

    setBusy(true);
    try {
      await addCategory({
        name: name.trim(),
        type,
        // an income category is a source, not a spending cap
        monthly_limit: type === "expense" ? n : null,
        color: PALETTE[data.categories.length % PALETTE.length],
      });
      toast(`Added ${name.trim()}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add budget item">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-name">Name</Label>
          <Input
            id="ab-name"
            autoFocus
            placeholder="Pets"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ab-type">Kind</Label>
            <Select
              id="ab-type"
              value={type}
              onChange={(e) => setType(e.target.value as CategoryType)}
            >
              <option value="expense">Spending</option>
              <option value="income">Income</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ab-limit">Monthly limit</Label>
            <Input
              id="ab-limit"
              type="number"
              step="10"
              min="0"
              inputMode="decimal"
              placeholder="Optional"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Leave the limit empty to track the category without budgeting it. Income categories
          have no limit — they show up as an income source instead.
        </p>

        {err && <p className="text-sm text-expense">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Adding…" : "Add item"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
