---
name: finance-ops
description: Do a finance operation in plain language — add/edit/delete a transaction, add an account, set a budget, update a debt. Trigger on "add expense", "log income", "spent X on Y", "new account", "set budget for X", "I paid the credit card", or any spoken/typed instruction that changes finance data.
---

# Finance operations

The full, authoritative procedure lives in [`../../CLAUDE.md`](../../CLAUDE.md) → **Standard actions**. Read it, then act. Do not re-derive from `serve.py`.

## Fast path

Server up (`python3 serve.py`, port 8787). Use the HTTP API — it validates and keeps balances consistent. Never hand-edit `data/data.db`.

Common: "add -30 food, account revolut" →
```bash
curl -s -X POST http://127.0.0.1:8787/api/transaction \
  -H 'Content-Type: application/json' \
  -d '{"date":"<today>","direction":"expense","amount":30,"category":"food","account":"revolut","name":"<what>"}'
```

Before writing:
- `category` must exist in `data/categories.json` AND its type match `direction` (expense category for an expense).
- `account` must exist in `data/accounts.json`.
- If the user names a category/account that doesn't exist → add it first, or ask. Never invent ids or amounts.
- `internal` = transfer between own accounts: use `flow`:`in`|`out` + `transfer_to`, no category.

Edit/delete/account/budget/debt endpoints + all fields → see CLAUDE.md. After any write, tell the user to refresh the dashboard.
