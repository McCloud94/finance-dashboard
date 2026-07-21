import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { Account, Category, Direction, Flow } from "@/types";
import type { NewEntry } from "@/hooks/useData";
import { todayDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  prefill?: Partial<NewEntry>;
  categories: Category[];
  accounts: Account[];
  addEntry: (e: NewEntry) => Promise<unknown>;
}

export function AddEntryDialog({ open, onClose, prefill, categories, accounts, addEntry }: Props) {
  const [direction, setDirection] = useState<Direction>("expense");
  const [date, setDate] = useState(todayDate());
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState("");
  // internal transfers only
  const [flow, setFlow] = useState<Flow>("out");
  const [transferTo, setTransferTo] = useState("");
  const [planned, setPlanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  // reset on open, applying prefill
  useEffect(() => {
    if (!open) return;
    setDirection(prefill?.direction ?? "expense");
    setDate(prefill?.date ?? todayDate());
    setName(prefill?.name ?? "");
    setAmount(prefill?.amount != null ? String(prefill.amount) : "");
    setCategory(prefill?.category ?? "");
    setAccount(prefill?.account ?? accounts[0]?.id ?? "");
    setFlow(prefill?.flow ?? "out");
    setTransferTo(prefill?.transfer_to ?? "");
    setPlanned(prefill?.planned ?? false);
    setErr(null);
  }, [open, prefill, accounts]);

  const internal = direction === "internal";
  const catOptions = categories.filter((c) => c.type === direction);

  async function submit() {
    setErr(null);
    const amt = parseFloat(amount);
    if (!name.trim()) return setErr("Name is required.");
    if (!(amt > 0)) return setErr("Amount must be greater than 0.");
    // a transfer has no category — the money did not leave your net worth
    if (!internal && !category) return setErr("Pick a category.");
    if (!account) return setErr("Pick an account.");
    if (internal && transferTo === account)
      return setErr("A transfer needs two different accounts.");
    if (!planned && date > todayDate()) return setErr("Non-planned entries can't be future-dated.");

    setBusy(true);
    try {
      await addEntry({
        date,
        name: name.trim(),
        amount: Math.round(amt * 100) / 100,
        direction,
        // `flow` is what signs the row: both legs of a transfer are
        // direction 'internal', so without it the balance cannot move.
        ...(internal
          ? { category: "", flow, ...(transferTo ? { transfer_to: transferTo } : {}) }
          : { category }),
        account,
        ...(planned ? { planned: true } : {}),
      });
      toast(`Added ${name.trim()}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add entry">
      <div className="flex flex-col gap-4">
        {/* direction segmented */}
        <div className="flex rounded-full bg-gray-100 p-1">
          {(["expense", "income", "internal"] as Direction[]).map((d) => (
            <button
              key={d}
              onClick={() => {
                setDirection(d);
                setCategory("");
              }}
              className={cn(
                "flex-1 rounded-full py-1.5 text-sm capitalize transition-colors",
                direction === d ? "bg-paper font-medium shadow-sm" : "text-gray-600",
              )}
            >
              {d === "internal" ? "Transfer" : d}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ae-date">Date</Label>
            <Input id="ae-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ae-amount">Amount (€)</Label>
            <Input
              id="ae-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ae-name">Name</Label>
          <Input id="ae-name" placeholder="e.g. Billa" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            {internal ? (
              <>
                <Label htmlFor="ae-flow">Direction</Label>
                <Select
                  id="ae-flow"
                  value={flow}
                  onChange={(e) => setFlow(e.target.value as Flow)}
                >
                  <option value="in">Money in</option>
                  <option value="out">Money out</option>
                </Select>
              </>
            ) : (
              <>
                <Label htmlFor="ae-cat">Category</Label>
                <Select id="ae-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select…</option>
                  {catOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ae-acct">{internal ? "On account" : "Account"}</Label>
            <Select id="ae-acct" value={account} onChange={(e) => setAccount(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {internal && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ae-to">Other account (optional)</Label>
            <Select
              id="ae-to"
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
            >
              <option value="">Unknown / outside</option>
              {accounts
                .filter((a) => a.id !== account)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
            <p className="text-xs text-gray-400">
              Informational. The balance moves on the account above, via Money in/out — where
              both accounts import statements, each side already has its own row, so crediting
              the other one here would count the transfer twice.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg bg-gray-100 px-4 py-3">
          <div>
            <Label htmlFor="ae-planned" className="text-ink">
              Planned
            </Label>
            <p className="text-xs text-gray-400">Future deal / scheduled payout — excluded from actuals.</p>
          </div>
          <Switch id="ae-planned" checked={planned} onChange={setPlanned} />
        </div>

        {err && <p className="text-sm text-expense">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Adding…" : "Add entry"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
