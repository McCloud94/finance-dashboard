import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useApp } from "@/app-context";
import type { DebtKind } from "@/types";

const KINDS: { value: DebtKind; label: string; hint: string }[] = [
  { value: "loan", label: "I owe someone", hint: "A family loan, a friend, anything you have to pay back." },
  { value: "owed_to_me", label: "Someone owes me", hint: "Counts towards your net worth, not against it." },
  {
    value: "credit_card",
    label: "Credit card",
    hint: "Pick the card's account — what is drawn on it is worked out from its transactions.",
  },
];

export function AddDebtDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addDebt, data } = useApp();
  const [kind, setKind] = useState<DebtKind>("loan");
  const [name, setName] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [balance, setBalance] = useState("");
  const [account, setAccount] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  // A card's outstanding is derived from its account, so only accounts of type
  // 'credit' can back one — offering the rest would produce a card whose
  // "owed" figure is really a bank balance.
  const cardAccounts = useMemo(
    () => data.accounts.filter((a) => a.type === "credit"),
    [data.accounts],
  );

  useEffect(() => {
    if (!open) return;
    setKind("loan");
    setName("");
    setCounterparty("");
    setBalance("");
    setAccount(cardAccounts[0]?.id ?? "");
    setCreditLimit("");
    setErr(null);
  }, [open, cardAccounts]);

  const isCard = kind === "credit_card";

  async function submit() {
    setErr(null);
    if (!name.trim()) return setErr("Name is required.");
    if (isCard && !account)
      return setErr("Add a credit-card account first (Accounts → Add account → Credit card).");
    const amt = balance.trim() === "" ? 0 : Number(balance);
    if (!Number.isFinite(amt) || amt < 0) return setErr("Amount must be 0 or more.");
    const limit = creditLimit.trim() === "" ? null : Number(creditLimit);
    if (limit !== null && !(limit >= 0)) return setErr("Credit limit must be 0 or more.");

    setBusy(true);
    try {
      await addDebt({
        name: name.trim(),
        kind,
        counterparty: counterparty.trim() || undefined,
        ...(isCard ? { account, credit_limit: limit } : { balance: amt }),
      });
      toast(`Added ${name.trim()}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  }

  const hint = KINDS.find((k) => k.value === kind)?.hint;

  return (
    <Modal open={open} onClose={onClose} title="Add debt">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ad-kind">Type</Label>
          <Select id="ad-kind" value={kind} onChange={(e) => setKind(e.target.value as DebtKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
          {hint && <p className="text-xs text-gray-400">{hint}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ad-name">Name</Label>
            <Input
              id="ad-name"
              autoFocus
              placeholder={isCard ? "Visa card" : "Loan from Mum"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ad-cp">Who (optional)</Label>
            <Input
              id="ad-cp"
              placeholder={isCard ? "Your bank" : "Mum"}
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
            />
          </div>
        </div>

        {isCard ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ad-acct">Card account</Label>
              <Select id="ad-acct" value={account} onChange={(e) => setAccount(e.target.value)}>
                {cardAccounts.length === 0 && <option value="">No credit accounts yet</option>}
                {cardAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ad-limit">Credit limit (optional)</Label>
              <Input
                id="ad-limit"
                type="number"
                step="50"
                min="0"
                inputMode="decimal"
                placeholder="1500"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ad-bal">Amount</Label>
            <Input
              id="ad-bal"
              type="number"
              step="10"
              min="0"
              inputMode="decimal"
              placeholder="0"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
            <p className="text-xs text-gray-400">
              What is still outstanding. Edit it here whenever it is paid down.
            </p>
          </div>
        )}

        {err && <p className="text-sm text-expense">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
