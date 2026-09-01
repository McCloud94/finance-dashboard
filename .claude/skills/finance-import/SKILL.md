---
name: finance-import
description: Import a bank statement / CSV export into the dashboard. Trigger on "import my statement", "here's my bank export", "load this CSV", "I dropped a statement in", or when the user attaches or otherwise provides a bank export file to ingest.
---

# Import a bank statement

Full procedure: the dashboard project's `CLAUDE.md` → **Importing a bank statement**. The user-facing script for the same loop: `AGENTS.md` → **Step 3**. Run all commands from the dashboard project root.

**One statement per cycle.** If the user hands you four exports, do four cycles — normalize, check categories, dry-run, commit, then the next file. `normalize.py` refuses a directory with more than one CSV, and `import_csv.py` refuses to commit when 30%+ of incoming non-transfer rows have no category. Both guards exist because a batch import of four files landed everything uncategorized and looked like it worked.

## Flow

The user gets one CSV to you one of two ways. Both end in the same three steps.

**Attached to the conversation** (the common case — they send the file to you
directly). Read the path off the attachment; it does not need to be moved into
the project, and a temp copy can be deleted after the import verifies.

```bash
python3 normalize.py --in /path/to/statement.csv --out data/normalized.csv
```

**Dropped into `Statements/`** (a standing folder, for people who prefer one — one file at a time in it).

```bash
python3 normalize.py                 # Statements/*.csv → data/normalized.csv
```

Then, either way:

```bash
python3 import_csv.py --dry-run      # preview counts + unmatched rows
python3 import_csv.py                # commit — additive, dedups by row id
```

Between normalize and dry-run sits the step that actually matters — see below.

The commit is safe to repeat: rows already in the DB are skipped, so overlapping
statements do not double up. Never reach for a replace flag to "clean up" a
re-import — that is not what it is for.

## The categorization gate (between normalize and import)

`normalize.py` prints an `UNCATEGORIZED` block whenever rows matched no rule: the count, and the payees behind it. Never skip past it.

1. Group the unmatched payees and propose mappings to the user in plain language — *"BILLA, TESCO and LIDL are all groceries → Food; that recurring €890 to ČSOB, is that rent?"* State the obvious ones as decisions; ask only about the genuinely ambiguous.
2. Write the confirmed mappings into `rules/categorize.json` (merchant regex → clean name → category id; patterns are matched lowercased and diacritics-stripped, so write them without accents).
3. Re-run `normalize.py` and confirm the count dropped to near zero.
4. Only then dry-run and commit.

Rules are what make next month's import instant and question-free. Fixing a row in the dashboard without adding the rule means being asked the same thing again on the next statement.

`--allow-multi` (normalize) and `--allow-uncategorized` (import) exist for the rare case where a guard is genuinely wrong. Reaching for either to make an import go through means the rules need fixing instead.

## When a bank isn't recognized

`normalize.py --report` shows an unmatched file → that bank has no parser profile. Write `profiles/<bank>.json` by copying `profiles/revolut.json` and mapping the columns. **Bank knowledge is data, never code.**

Categorization for all banks lives in `rules/categorize.json` (merchant regex → clean name → category). Add rules there when transactions land uncategorized.

## Rules

- One file per cycle. Never batch.
- Always `--dry-run` first, show the user counts + unmatched, then commit.
- Never commit without having read the uncategorized count.
- Human edits live in `tx_overrides` and survive every import. Never write to `tx_overrides` from an import step.
- Re-importing a statement *after changing the categorize rules* changes row ids, so the old rows have to be cleared first. That is scoped to the one file: `python3 import_csv.py --replace --replace-source-file Revolut.csv`. It is destructive to that statement's imported rows — confirm with the user first. Plain `--replace` is rejected by design.
- If the import dry-run lists planned entries the statement fulfils, show those lines to the user before committing: each one is a hand-typed row that will be dropped in favour of the bank's own.
