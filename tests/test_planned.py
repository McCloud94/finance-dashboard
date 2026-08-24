"""Planned entries: the date sweep that settles them, the manual override that
stands the sweep down, and the import reconcile that stops a settled entry from
being counted twice.

The failure these guard against is silent and expensive. A planned rent entry
settles on the 25th; the bank posts the same payment on the 27th under a different
name; the row ids differ, so nothing dedups them, and €915 leaves the books
twice. Everything below exists to keep that from coming back.
"""

import sqlite3
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from import_csv import NEW_COLS, reconcile_settled  # noqa: E402
from serve import Store  # noqa: E402

SCHEMA = """
CREATE TABLE transactions (
    id TEXT PRIMARY KEY, date TEXT, name TEXT, merchant TEXT, amount REAL,
    direction TEXT, category TEXT, account TEXT, transfer_to TEXT, flow TEXT,
    refund INTEGER DEFAULT 0, note TEXT, source TEXT, source_file TEXT,
    planned INTEGER DEFAULT 0, auto_settle INTEGER DEFAULT 1, settled_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE tx_overrides (id TEXT PRIMARY KEY, fields TEXT, updated_at TEXT);
"""

# Relative to the real clock: the sweep compares against date.today(), so fixed
# dates here would quietly turn into "all in the past" and stop testing anything.
TODAY = date.today().isoformat()
PAST = (date.today() - timedelta(days=5)).isoformat()
FUTURE = (date.today() + timedelta(days=30)).isoformat()


def row(id, date, amount=915.0, account="checking", direction="expense",
        source="manual", planned=0, **kw):
    r = {
        "id": id, "date": date, "name": id, "merchant": id, "amount": amount,
        "direction": direction, "category": None, "account": account,
        "transfer_to": None, "flow": None, "refund": 0, "note": None,
        "source": source, "source_file": None, "planned": planned,
        "auto_settle": 1, "settled_at": None,
    }
    r.update(kw)
    return r


class SweepTests(unittest.TestCase):
    """Store._settle_due_planned — the 'planned rent is real once the 25th
    arrives' rule. It runs on the overlaid rows, so a dashboard edit to `date`
    counts, and it only ever touches manual rows."""

    def setUp(self):
        self.con = sqlite3.connect(":memory:")
        self.con.row_factory = sqlite3.Row
        self.con.executescript(SCHEMA)

    def insert(self, r):
        cols = ",".join(r)
        self.con.execute(
            f"INSERT INTO transactions ({cols}) VALUES ({','.join('?' * len(r))})",
            tuple(r.values()))
        return r

    def sweep(self, rows):
        # mirrors snapshot(): planned arrives coerced to a bool by _overlay
        for r in rows:
            r["planned"] = bool(r["planned"])
        Store._settle_due_planned(self.con, rows)
        return rows

    def stored(self, id):
        return dict(self.con.execute(
            "SELECT planned, auto_settle, settled_at FROM transactions WHERE id=?",
            (id,)).fetchone())

    def _at(self, date, **kw):
        r = self.insert(row("rent", date, planned=1, **kw))
        self.sweep([r])
        return self.stored("rent"), r

    def test_settles_once_the_date_has_arrived(self):
        stored, live = self._at(PAST)
        self.assertEqual(stored["planned"], 0)
        self.assertIsNotNone(stored["settled_at"])
        # the snapshot being built must agree with the row just written, or the
        # dashboard shows 'Planned' until the next refresh
        self.assertFalse(live["planned"])

    def test_settles_on_the_day_itself(self):
        # rent leaves the account ON the 25th, not the day after
        stored, _ = self._at(TODAY)
        self.assertEqual(stored["planned"], 0)

    def test_leaves_a_future_plan_alone(self):
        stored, _ = self._at(FUTURE)
        self.assertEqual(stored["planned"], 1)
        self.assertIsNone(stored["settled_at"])

    def test_never_settles_an_imported_row(self):
        """An imported row is the bank's record of money that already moved.
        Nothing here may rewrite it — the importer owns those rows."""
        stored, _ = self._at(PAST, source="import")
        self.assertEqual(stored["planned"], 1)

    def test_respects_a_dashboard_edit_to_the_date(self):
        """The overlaid date wins. A `WHERE date <= today` in SQL would read the
        base row and settle a plan the user has already pushed forward."""
        r = self.insert(row("rent", PAST, planned=1))
        r["date"] = FUTURE  # what tx_overrides would have layered on
        self.sweep([r])
        self.assertEqual(self.stored("rent")["planned"], 1)

    def test_suppressed_row_is_not_re_settled(self):
        r = self.insert(row("rent", PAST, planned=1, auto_settle=0))
        self.sweep([r])
        self.assertEqual(self.stored("rent")["planned"], 1)

    def test_moving_a_suppressed_plan_forward_re_arms_it(self):
        """Otherwise one 'no, not yet' would disable auto-settling on that row
        permanently, and next month's rent would sit as Planned forever."""
        r = self.insert(row("rent", FUTURE, planned=1, auto_settle=0))
        self.sweep([r])
        self.assertEqual(self.stored("rent")["auto_settle"], 1)
        self.assertEqual(self.stored("rent")["planned"], 1)


class SetPlannedTests(unittest.TestCase):
    """Store.set_planned — the manual correction, written to the row rather than
    to tx_overrides."""

    def setUp(self):
        # Store opens a fresh connection per call, so an in-memory DB would be
        # empty on the second one — this class needs a real file.
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / "t.db")
        self.store = Store(self.path)
        con = sqlite3.connect(self.path)
        con.executescript(SCHEMA)
        for r in (row("rent", PAST, planned=0, settled_at="2026-08-10 00:00:00"),
                  row("bank-rent", PAST, source="import")):
            con.execute(
                f"INSERT INTO transactions ({','.join(r)}) "
                f"VALUES ({','.join('?' * len(r))})", tuple(r.values()))
        con.commit()
        con.close()

    def tearDown(self):
        self.tmp.cleanup()

    def stored(self, id):
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        r = dict(con.execute(
            "SELECT planned, auto_settle, settled_at FROM transactions WHERE id=?",
            (id,)).fetchone())
        con.close()
        return r

    def test_flip_back_to_planned_suppresses_the_sweep(self):
        """'This didn't actually happen yet' has to stick. Without clearing
        auto_settle the next page load would settle it straight back."""
        self.store.set_planned("rent", True)
        self.assertEqual(self.stored("rent"),
                         {"planned": 1, "auto_settle": 0, "settled_at": None})

    def test_marking_it_happened_stamps_settled_at(self):
        """Same marker the sweep leaves, so the import reconcile treats a
        hand-settled entry exactly like an auto-settled one."""
        self.store.set_planned("rent", True)
        self.store.set_planned("rent", False)
        s = self.stored("rent")
        self.assertEqual(s["planned"], 0)
        self.assertIsNotNone(s["settled_at"])

    def test_planned_is_written_to_the_row_not_to_an_override(self):
        """If it lived in tx_overrides it would shadow the sweep's write to the
        base column forever, and the row could never change state again."""
        self.store.set_planned("rent", True)
        con = sqlite3.connect(self.path)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM tx_overrides").fetchone()[0], 0)
        con.close()

    def test_imported_rows_cannot_be_marked_planned(self):
        self.assertEqual(self.store.set_planned("bank-rent", True), "not-manual")
        self.assertEqual(self.stored("bank-rent")["planned"], 0)

    def test_missing_row(self):
        self.assertIsNone(self.store.set_planned("nope", True))


class ReconcileSettledTests(unittest.TestCase):
    """import_csv.reconcile_settled — the looser match that catches what the row
    id cannot, because a planned entry's date and name both drift from the
    statement's."""

    def setUp(self):
        self.con = sqlite3.connect(":memory:")
        self.con.executescript(SCHEMA)
        self.cur = self.con.cursor()

    def add(self, r):
        self.cur.execute(
            f"INSERT INTO transactions ({','.join(r)}) "
            f"VALUES ({','.join('?' * len(r))})", tuple(r.values()))

    @staticmethod
    def incoming(id, date, amount=915.0, account="checking", direction="expense"):
        r = row(id, date, amount, account, direction, source="import")
        return tuple(r[c] for c in NEW_COLS)

    def test_matches_across_a_name_and_date_drift(self):
        """The real case: 'Rent' on the 25th vs 'Rent (deposit + 2x rent)' on
        the 27th. Different ids, one payment."""
        self.add(row("planned-rent", "2026-07-25", settled_at="x"))
        got = reconcile_settled(self.cur, [self.incoming("bank-rent", "2026-07-27")])
        self.assertEqual(got, [("planned-rent", "bank-rent")])

    def test_ignores_a_manual_row_that_was_never_planned(self):
        """The safety property. A hand-typed entry with no settled_at is not a
        fulfilled plan, and a look-alike statement row must not delete it."""
        self.add(row("typed-by-hand", "2026-07-25"))
        self.assertEqual(
            reconcile_settled(self.cur, [self.incoming("bank-rent", "2026-07-27")]), [])

    def test_ignores_a_different_account(self):
        self.add(row("planned-rent", "2026-07-25", settled_at="x"))
        self.assertEqual(
            reconcile_settled(
                self.cur, [self.incoming("b", "2026-07-27", account="revolut")]), [])

    def test_ignores_a_different_direction(self):
        """Same amount in and out within a week is a transfer or a refund, not
        the plan being fulfilled."""
        self.add(row("planned-rent", "2026-07-25", settled_at="x"))
        self.assertEqual(
            reconcile_settled(
                self.cur, [self.incoming("b", "2026-07-27", direction="income")]), [])

    def test_ignores_a_different_amount(self):
        self.add(row("planned-rent", "2026-07-25", settled_at="x"))
        self.assertEqual(
            reconcile_settled(self.cur, [self.incoming("b", "2026-07-27", amount=920.0)]), [])

    def test_tolerates_rounding_within_a_cent(self):
        self.add(row("planned-rent", "2026-07-25", amount=915.0, settled_at="x"))
        got = reconcile_settled(self.cur, [self.incoming("b", "2026-07-27", amount=915.004)])
        self.assertEqual(len(got), 1)

    def test_ignores_a_row_outside_the_date_window(self):
        self.add(row("planned-rent", "2026-07-25", settled_at="x"))
        self.assertEqual(
            reconcile_settled(self.cur, [self.incoming("b", "2026-08-25")]), [])

    def test_matches_a_statement_row_dated_before_the_plan(self):
        # the bank can post early; the window is symmetric
        self.add(row("planned-rent", "2026-07-25", settled_at="x"))
        self.assertEqual(
            len(reconcile_settled(self.cur, [self.incoming("b", "2026-07-22")])), 1)

    def test_each_plan_is_consumed_at_most_once(self):
        """Two identical statement rows in the window are two real payments. One
        cancels the plan; the other has to survive as its own row."""
        self.add(row("planned-rent", "2026-07-25", settled_at="x"))
        got = reconcile_settled(self.cur, [
            self.incoming("bank-a", "2026-07-26"),
            self.incoming("bank-b", "2026-07-27"),
        ])
        self.assertEqual(got, [("planned-rent", "bank-a")])

    def test_older_db_without_the_column_is_a_no_op(self):
        self.cur.executescript(
            "DROP TABLE transactions;"
            "CREATE TABLE transactions (id TEXT PRIMARY KEY, date TEXT, amount REAL,"
            " direction TEXT, account TEXT, source TEXT);")
        self.assertEqual(
            reconcile_settled(self.cur, [self.incoming("b", "2026-07-27")]), [])


if __name__ == "__main__":
    unittest.main()
