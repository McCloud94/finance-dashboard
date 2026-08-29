import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useApp } from "@/app-context";
import type { AccountType } from "@/types";

const TYPES: { value: AccountType; label: string }[] = [
  { value: "bank", label: "Bank account" },
  { value: "cash", label: "Cash" },
  { value: "credit", label: "Credit card" },
  { value: "broker", label: "Broker" },
  { value: "crypto", label: "Crypto" },
  { value: "prop_firm", label: "Prop firm" },
];

export function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addAccount } = useApp();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("bank");
  const [currency, setCurrency] = useState("EUR");
  const [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("bank");
    setCurrency("EUR");
    setOpening("");
    setErr(null);
  }, [open]);

  // A credit card's balance is what you owe, so its starting figure is entered
  // as a positive "owed" number and booked as money out.
  const credit = type === "credit";

  async function submit() {
    setErr(null);
    if (!name.trim()) return setErr("Name is required.");
    const raw = opening.trim();
    const amount = raw === "" ? 0 : Number(raw);
    if (raw !== "" && !Number.isFinite(amount)) return setErr("Starting balance must be a number.");
    if (credit && amount < 0) return setErr("Enter what you owe as a positive number.");

    setBusy(true);
    try {
      await addAccount({
        name: name.trim(),
        type,
        currency: currency.trim().toUpperCase() || "EUR",
        opening_balance: credit ? -Math.abs(amount) : amount,
      });
      toast(`Added ${name.trim()}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add account">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="aa-name">Name</Label>
          <Input
            id="aa-name"
            autoFocus
            placeholder="Revolut"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aa-type">Type</Label>
            <Select id="aa-type" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aa-cur">Currency</Label>
            <Input
              id="aa-cur"
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="aa-open">{credit ? "Currently owed" : "Balance today"}</Label>
          <Input
            id="aa-open"
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder="0"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <p className="text-xs text-gray-400">
            Balances are added up from your transactions, so this is recorded as one starting
            entry rather than a number on its own. It counts as neither income nor spending.
          </p>
        </div>

        {err && <p className="text-sm text-expense">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Adding…" : "Add account"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
