import csv
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def seed_db(path):
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, color TEXT, type TEXT);
        CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, type TEXT, balance REAL, currency TEXT, meta TEXT);
        CREATE TABLE transactions (
            id TEXT PRIMARY KEY, date TEXT, name TEXT, merchant TEXT, amount REAL,
            direction TEXT, category TEXT, account TEXT, transfer_to TEXT, flow TEXT,
            refund INTEGER, note TEXT, source TEXT, planned INTEGER DEFAULT 0,
            source_file TEXT
        );
        CREATE TABLE tx_deleted (id TEXT PRIMARY KEY);
        CREATE TABLE tx_overrides (id TEXT PRIMARY KEY, fields TEXT, updated_at TEXT);
    """)
    con.executemany("INSERT INTO categories VALUES (?,?,?,?)", [
        ("food", "Food", "#1", "expense"),
        ("groceries", "Groceries", "#2", "expense"),
    ])
    con.executemany("INSERT INTO accounts VALUES (?,?,?,?,?,?)", [
        ("bybit", "Bybit", "bank", 0, "EUR", "{}"),
        ("revolut", "Revolut", "bank", 0, "EUR", "{}"),
    ])
    con.execute("INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
        "old-revolut", "2026-07-01", "Old Revolut", "Old Revolut", 10,
        "expense", "food", "revolut", None, None, 0, None, "import", 0,
        "Revolut.csv"))
    con.commit()
    con.close()


def write_normalized(path):
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[
            "date", "name", "merchant", "amount", "direction", "flow", "refund",
            "account", "transfer_to", "category", "note", "source_file",
        ])
        w.writeheader()
        w.writerow({
            "date": "2026-08-01", "name": "New Bybit", "merchant": "New Bybit",
            "amount": "5", "direction": "expense", "flow": "", "refund": "",
            "account": "bybit", "transfer_to": "", "category": "groceries",
            "note": "", "source_file": "Bybit.csv",
        })


class ImportSafetyTests(unittest.TestCase):
    def run_import(self, db, normalized, *args):
        return subprocess.run(
            [sys.executable, "import_csv.py", "--db", str(db), "--in", str(normalized), *args],
            cwd=ROOT, text=True, capture_output=True,
        )

    def test_replace_requires_explicit_scope(self):
        with tempfile.TemporaryDirectory() as d:
            db, normalized = Path(d) / "data.db", Path(d) / "normalized.csv"
            seed_db(db)
            write_normalized(normalized)
            result = self.run_import(db, normalized, "--replace")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("explicit", (result.stderr + result.stdout).lower())
            con = sqlite3.connect(db)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0], 1)

    def test_scoped_replace_preserves_other_statement_rows(self):
        with tempfile.TemporaryDirectory() as d:
            db, normalized = Path(d) / "data.db", Path(d) / "normalized.csv"
            seed_db(db)
            write_normalized(normalized)
            result = self.run_import(db, normalized, "--replace-source-file", "Bybit.csv")
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            con = sqlite3.connect(db)
            rows = con.execute("SELECT source_file, account FROM transactions ORDER BY id").fetchall()
            self.assertEqual(rows, [("Bybit.csv", "bybit"), ("Revolut.csv", "revolut")])

    def test_scoped_replace_matches_legacy_null_source_file_only_by_row_id(self):
        with tempfile.TemporaryDirectory() as d:
            db, normalized = Path(d) / "data.db", Path(d) / "normalized.csv"
            seed_db(db)
            con = sqlite3.connect(db)
            con.execute("UPDATE transactions SET id='2026-08-01|bybit|5|new-bybit', account='bybit', source_file=NULL WHERE id='old-revolut'")
            con.commit()
            con.close()
            write_normalized(normalized)
            result = self.run_import(db, normalized, "--replace-source-file", "Bybit.csv")
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            con = sqlite3.connect(db)
            rows = con.execute("SELECT account, source_file FROM transactions ORDER BY id").fetchall()
            self.assertEqual(rows, [("bybit", "Bybit.csv")])

    def test_scoped_replace_rejects_without_deleting_existing_source(self):
        with tempfile.TemporaryDirectory() as d:
            db, normalized = Path(d) / "data.db", Path(d) / "normalized.csv"
            seed_db(db)
            write_normalized(normalized)
            text = normalized.read_text()
            normalized.write_text(text.replace("groceries", "unknown-category"))
            result = self.run_import(db, normalized, "--replace-source-file", "Bybit.csv")
            self.assertNotEqual(result.returncode, 0)
            con = sqlite3.connect(db)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0], 1)
            self.assertEqual(con.execute("SELECT source_file FROM transactions").fetchone()[0], "Revolut.csv")

    def test_normalize_accepts_single_file(self):
        # Uses the shipped Wise profile: the point is that one file in gets one
        # normalized row out, tagged with the file it came from.
        with tempfile.TemporaryDirectory() as d:
            source, output = Path(d) / "Wise.csv", Path(d) / "normalized.csv"
            source.write_text(
                "Description,Date,Amount\n"
                "Card transaction of 5.00 EUR issued by Shop,01-08-2026,-5.00\n",
                encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "normalize.py", "--in", str(source), "--out", str(output)],
                cwd=ROOT, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            with output.open(encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["source_file"], "Wise.csv")
            self.assertEqual(rows[0]["account"], "wise")


if __name__ == "__main__":
    unittest.main()
