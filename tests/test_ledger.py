"""Transfer pairing — the rule that decides whether a transfer moves one account
or two. Getting it wrong is silent: money either vanishes (Bybit drifting
negative because nothing credited the deposits) or is invented (an account->card
payback counted on both the row the account exported and the row the card exported)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ledger import account_balances, pair_internal  # noqa: E402

ACCOUNTS = ["checking", "card", "revolut", "bybit"]


def tx(id, date, account, amount, direction="expense", **kw):
    row = {
        "id": id, "date": date, "account": account, "amount": amount,
        "direction": direction, "transfer_to": None, "flow": None,
        "refund": 0, "planned": 0,
    }
    row.update(kw)
    return row


class TestPairing(unittest.TestCase):
    def test_both_legs_exported_moves_each_account_once(self):
        """account -> card: both banks export it, so two rows already exist."""
        rows = [
            tx("a", "2026-06-27", "checking", 590, "internal", flow="out", transfer_to="card"),
            tx("b", "2026-06-27", "card", 590, "internal", flow="in", transfer_to="checking"),
        ]
        pairs = pair_internal(rows)
        self.assertEqual(pairs["a"], "b")
        self.assertEqual(pairs["b"], "a")
        bal = account_balances(rows, ACCOUNTS)
        self.assertEqual(bal["checking"], -590)
        self.assertEqual(bal["card"], 590)

    def test_legs_pair_across_a_few_days(self):
        """Banks post the same movement on different days."""
        rows = [
            tx("a", "2026-06-27", "checking", 590, "internal", flow="out", transfer_to="card"),
            tx("b", "2026-06-29", "card", 590, "internal", flow="in", transfer_to="checking"),
        ]
        self.assertEqual(pair_internal(rows).get("a"), "b")

    def test_one_sided_transfer_moves_both_accounts(self):
        """Revolut -> Bybit: only Revolut exports it. Without the mirrored leg
        Bybit spends against a balance nothing tops up and goes negative."""
        rows = [
            tx("a", "2026-06-03", "revolut", 500, "internal", flow="out", transfer_to="bybit"),
            tx("b", "2026-06-10", "bybit", 120),
        ]
        self.assertIsNone(pair_internal(rows).get("a"))
        bal = account_balances(rows, ACCOUNTS)
        self.assertEqual(bal["revolut"], -500)
        self.assertEqual(bal["bybit"], 380)

    def test_hand_typed_card_payback_reduces_the_card(self):
        """The bug this was written for: a manual account -> card transfer left
        the card's outstanding untouched."""
        rows = [
            tx("card", "2026-07-10", "card", 1380),
            tx("pay", "2026-07-27", "checking", 788, "internal", flow="out", transfer_to="card"),
        ]
        bal = account_balances(rows, ACCOUNTS)
        self.assertEqual(bal["card"], -592)  # outstanding 592, not 1380
        self.assertEqual(bal["checking"], -788)

    def test_a_leg_is_never_claimed_twice(self):
        """Two same-amount transfers on the same day must consume two legs."""
        rows = [
            tx("o1", "2026-05-01", "checking", 100, "internal", flow="out", transfer_to="card"),
            tx("o2", "2026-05-01", "checking", 100, "internal", flow="out", transfer_to="card"),
            tx("i1", "2026-05-01", "card", 100, "internal", flow="in", transfer_to="checking"),
        ]
        pairs = pair_internal(rows)
        claimed = [k for k in ("o1", "o2") if pairs.get(k)]
        self.assertEqual(len(claimed), 1)
        # the unpaired one still has to deliver its money
        bal = account_balances(rows, ACCOUNTS)
        self.assertEqual(bal["checking"], -200)
        self.assertEqual(bal["card"], 200)

    def test_far_apart_legs_do_not_pair(self):
        rows = [
            tx("a", "2026-06-01", "checking", 590, "internal", flow="out", transfer_to="card"),
            tx("b", "2026-06-20", "card", 590, "internal", flow="in", transfer_to="checking"),
        ]
        self.assertIsNone(pair_internal(rows).get("a"))

    def test_planned_and_refund_still_behave(self):
        rows = [
            tx("p", "2026-06-01", "revolut", 900, "expense", planned=1),
            tx("r", "2026-06-02", "revolut", 40, "expense", refund=1),
            tx("e", "2026-06-03", "revolut", 10, "expense"),
        ]
        self.assertEqual(account_balances(rows, ACCOUNTS)["revolut"], 30)

    def test_as_of_excludes_later_rows_from_both_legs(self):
        rows = [
            tx("a", "2026-08-01", "revolut", 500, "internal", flow="out", transfer_to="bybit"),
        ]
        bal = account_balances(rows, ACCOUNTS, as_of="2026-07-19")
        self.assertEqual(bal["revolut"], 0)
        self.assertEqual(bal["bybit"], 0)


if __name__ == "__main__":
    unittest.main()
