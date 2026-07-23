---
name: finance-analysis
description: Analyze the user's finances and produce a structured monthly review — spending trends, budget adherence, and concrete cost-cutting suggestions. Trigger on "how am I doing", "monthly review", "where can I cut costs", "analyze my spending", "financial debrief", or any request for insight (not a data edit).
---

# Finance analysis & monthly review

Read-only. You look at the data and advise — you do NOT add/edit transactions here (that is `finance-ops`).

## Get the data

Server must be running (`python3 serve.py`, port 8787). Pull everything once:

```bash
curl -s http://127.0.0.1:8787/api/data
```

Returns `{accounts, transactions, categories, budget, debts, metrics}`. Aggregate the JSON yourself — never guess figures. Each transaction has: `date`, `direction` (income|expense|internal), `amount`, `category`, `account`, `name`, `merchant`. Ignore `internal` transfers in spend/income totals (they move money between the user's own accounts, not real flow).

## Monthly review — structure

Default window = the current calendar month vs the prior full month. Produce:

1. **Headline** — net this month (income − expense), vs last month, direction of travel.
2. **Income** — total, sources if labeled, vs planned_income in `budget.json`.
3. **Spending by category** — sorted desc. For each: amount, share of spend, vs last month (Δ%), vs `budget.monthly[category]` limit (over/under, by how much).
4. **Budget breaches** — categories over limit, flagged first.
5. **Accounts & debt** — current balances; credit-card `due_amount`/`due_date` from `debts`; runway = liquid balance ÷ avg monthly spend.
6. **3 concrete optimizations** — see below.

## Cost-cutting — be specific, not preachy

Don't say "spend less on food." Find the actual lever:
- **Recurring/subscriptions** — group by `merchant`; repeated same-amount monthly hits = subs. List them, flag ones that look unused or duplicated (two streaming, two clouds).
- **Category creep** — a category up >20% vs its 3-month average → name it, show the transactions driving it.
- **Small-frequent drain** — many sub-€10 hits at same merchant (coffee, taxi, delivery) → total them monthly so the aggregate is visible.
- **Fee/FX** — bank fees, ATM, FX markups in transaction names → surface annualized.

Each optimization = `[lever] → [€ / month saved] → [one action]`. Rank by € impact. Never moralize; state the number, let the user decide.

## Rules

- Every figure traces to a transaction or a config value. If data is thin (< 1 full month), say so and give a partial read, don't extrapolate wildly.
- Amounts in the user's currency (accounts carry `currency`; default EUR).
- Output = tight markdown. Lead with the headline number. No filler.
