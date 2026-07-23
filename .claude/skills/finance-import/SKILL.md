---
name: finance-import
description: Import a bank statement / CSV export into the dashboard. Trigger on "import my statement", "here's my bank export", "load this CSV", "I dropped a statement in", or when the user provides a bank export file to ingest.
---

# Import a bank statement

Full procedure: [`../../CLAUDE.md`](../../CLAUDE.md) → **Importing a bank statement**. Follow it.

## Flow

1. User drops the export into `Statements/`.
2. Normalize → preview → commit:
```bash
python3 normalize.py                 # Statements/*.csv → data/normalized.csv
python3 import_csv.py --dry-run      # preview counts + unmatched rows
python3 import_csv.py --replace      # commit (DESTRUCTIVE to derived data — confirm with user first)
```

## When a bank isn't recognized

`normalize.py --report` shows an unmatched file → that bank has no parser profile. Write `profiles/<bank>.json` by copying `profiles/revolut.json` and mapping the columns. **Bank knowledge is data, never code.**

Categorization for all banks lives in `rules/categorize.json` (merchant regex → clean name → category). Add rules there when transactions land uncategorized.

## Rules

- `import_csv.py --replace` rebuilds derived `transactions` — human edits in `tx_overrides` are preserved automatically; never write to `tx_overrides` from an import step.
- Always `--dry-run` first, show the user counts + unmatched, confirm before `--replace`.
