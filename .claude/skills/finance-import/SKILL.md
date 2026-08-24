---
name: finance-import
description: Import a bank statement / CSV export into the dashboard. Trigger on "import my statement", "here's my bank export", "load this CSV", "I dropped a statement in", or when the user attaches or otherwise provides a bank export file to ingest.
---

# Import a bank statement

Full procedure: the dashboard project's `CLAUDE.md` → **Importing a bank statement**. Follow it (run all commands from the dashboard project root).

## Flow

The user gets the CSV to you one of two ways. Both end in the same three steps.

**Attached to the conversation** (the common case — they send the file to you
directly). Read the path off the attachment; it does not need to be moved into
the project, and a temp copy can be deleted after the import verifies.

```bash
python3 normalize.py --in /path/to/statement.csv --out data/normalized.csv
```

**Dropped into `Statements/`** (a standing folder, for people who prefer one).

```bash
python3 normalize.py                 # Statements/*.csv → data/normalized.csv
```

Then, either way:

```bash
python3 import_csv.py --dry-run      # preview counts + unmatched rows
python3 import_csv.py                # commit — additive, dedups by row id
```

The commit is safe to repeat: rows already in the DB are skipped, so overlapping
statements do not double up. Never reach for a replace flag to "clean up" a
re-import — that is not what it is for.

## When a bank isn't recognized

`normalize.py --report` shows an unmatched file → that bank has no parser profile. Write `profiles/<bank>.json` by copying `profiles/revolut.json` and mapping the columns. **Bank knowledge is data, never code.**

Categorization for all banks lives in `rules/categorize.json` (merchant regex → clean name → category). Add rules there when transactions land uncategorized.

## Rules

- Always `--dry-run` first, show the user counts + unmatched, then commit.
- Human edits live in `tx_overrides` and survive every import. Never write to `tx_overrides` from an import step.
- Re-importing a statement *after changing the categorize rules* changes row ids, so the old rows have to be cleared first. That is scoped to the one file: `python3 import_csv.py --replace --replace-source-file Revolut.csv`. It is destructive to that statement's imported rows — confirm with the user first. Plain `--replace` is rejected by design.
- If the import dry-run lists planned entries the statement fulfils, show those lines to the user before committing: each one is a hand-typed row that will be dropped in favour of the bank's own.
