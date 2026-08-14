# Fund Guru 📈

A screener for Indian **direct-plan** mutual funds. It ranks funds against their own sub-category on
returns, cost, and risk-adjusted metrics, and shows what tax treatment does to those returns.

> **Not investment advice.** This is a personal screening tool over publicly available data. It is
> not SEBI-registered as an Investment Adviser or Research Analyst, and nothing it outputs is a
> recommendation to buy, sell, hold, or continue any scheme. Rankings are arithmetic over historical
> figures; past performance does not indicate future returns. Tax figures are illustrative — verify
> against [incometax.gov.in](https://incometax.gov.in) before relying on them.

## What works today

| Feature | Status | Notes |
| --- | --- | --- |
| **Fund Explorer** | ✅ Working | Filter by category, sub-category, fund house, risk, tax bucket, returns, expense ratio, AUM, Sharpe, alpha. Sort on any column. Compare up to 4 funds side by side. |
| **Peer Score** | ✅ Working | Percentile ranking within sub-category. Weights are admin-configurable. |
| **Fund Detail** | ✅ Working | Full metrics, score breakdown with peer count and metric coverage, tax profile, peer funds. |
| **Tax layer** | ✅ Working | Bucket classification from allocation, holding-period thresholds, approximate post-tax returns. |
| **Redemption calculator** | ✅ Working | Amount + holding-period slider → value after exit load and capital gains tax. See [below](#redemption-calculator). |
| **Track record filter** | ✅ Working | Minimum-history gate, defaulted to 3y. See [below](#track-record--filtering-out-new-funds). |
| **Dashboard** | ✅ Working | Universe stats, top 3 per category, shortlist filtered by riskometer band. |
| **Data sync** | ✅ Working | Local CLI only — see [Data pipeline](#data-pipeline). |
| **Auth** | ✅ Working | Google sign-in; admin gated by Firestore rules. |
| **SIP Tracker** | ⚠️ Prototype | UI works but runs on hardcoded sample SIPs and nothing persists. Its continue/pause/stop rules are not trustworthy and are pending a rewrite. |
| **Portfolio / Reports / Goals** | ⚠️ Mock | Static sample data, no persistence. Design mocks, not features. |

## How the Peer Score works

Every metric is converted to a **percentile within the fund's own peer group** (sub-category, or
category as a fallback) before being weighted. Three reasons:

1. **Units stop mattering.** A 3Y CAGR in percent, a Sharpe ratio near 1, and an expense ratio in
   percent are not addable quantities. Percentiles are.
2. **Categories stop competing unfairly.** A small-cap fund returning 22% and a liquid fund
   returning 7% can both be top-decile *for what they are*.
3. **Weights become interpretable.** With every input on 0-100 and weights summing to 1, the output
   is a 0-100 score, and a weight of 0.20 genuinely means "20% of the decision".

Default weights, deliberately tilted toward long horizons:

| Metric | Weight | Rationale |
| --- | --- | --- |
| 3Y return | 0.20 | Long horizons carry most of the weight. Trailing 6M/1Y numbers are extremely |
| 5Y return | 0.20 | start-date sensitive; ranking on them just surfaces whatever ran hot recently. |
| 1Y return | 0.10 | |
| 6M return | 0.05 | |
| Expense ratio | 0.10 | Inverted — the only input that is a guaranteed, known drag on returns. |
| Sharpe ratio | 0.10 | Return per unit of total volatility. |
| Sortino ratio | 0.05 | Return per unit of *downside* volatility. |
| Alpha | 0.05 | Excess return over the benchmark. |
| Information ratio | 0.05 | Consistency of that excess return. |
| Beat category | 0.05 | Average excess over the fund's own category, across 1Y/3Y/5Y. |
| Rank consistency | 0.05 | Stability of category rank across horizons — the anti-momentum term. |
| **Total** | **1.00** | |
| Risk tilt | 0.10 | A multiplier applied *after* the weighted sum, so not part of the total. Gives a ±10% swing between the safest and riskiest riskometer buckets. |

### Missing data and confidence

Scoring a fund only on the metrics it happens to have sounds fair, but creates a perverse incentive:
a brand-new passive fund-of-fund with no return history and a 0.06% expense ratio scores in the high
90s off that single metric, outranking a fund with a decade of top-quartile results. **Less data
produced a better score**, because the metrics that would have dragged it down were not counted.

So an unmeasurable metric is treated as **average**, not absent. The score is shrunk toward the
neutral 50 in proportion to how little is known:

```
score = measuredScore × confidence + 50 × (1 − confidence)
confidence = coverage × min(1, peerCount / 5)
```

A fully covered fund is unaffected. A fund with 10% coverage lands near 50 however good that 10%
looks — the honest answer, since there is almost no evidence either way. Peer-group size feeds in for
the same reason: "top third of three funds" is not information.

Funds below **40% coverage** are excluded from curated rankings (dashboard tiles, shortlists, top-N)
because they have no meaningful ranking and showing them a score implies otherwise. They stay visible
in the explorer, which is a browse surface, with a "Limited data" flag and the unshrunk
`measuredScore` shown on the detail page for context.

The effect on the example above: score drops from 97.8 to 49.0, and it no longer appears in any
ranked list.

## Tax layer

Rates live in one dated table (`TAX_REGIME` in [`src/utils/taxation.ts`](src/utils/taxation.ts)) so a
Budget change is a one-file edit. Classification is by **asset allocation**, not scheme name, because
that is how the Act is written:

| Bucket | Trigger | Long-term after | Notes |
| --- | --- | --- | --- |
| Equity-oriented | ≥65% equity | 12 months | Flat rates — the holder's slab does not change the tax. Per-PAN annual exemption applies. |
| Hybrid | 35-65% equity | 24 months | Short-term gains at slab. |
| Specified debt | ≤35% equity | never | Always at slab, no indexation. **The only bucket where holding in a lower-slab account actually saves tax.** |
| Gold / commodity | name or category match | 24 months | Physical gold, ETFs and gold funds are not all alike — check the vehicle. |
| International / FoF | name match | 24 months | Checked *before* allocation: a US equity feeder holds 100% equity but is not equity-oriented for Indian tax. |

Post-tax figures deliberately return `null` rather than assuming a 30% slab when the bucket is
slab-taxed and no marginal rate was supplied. They are also a **single-lot approximation** — good
enough to compare two funds, not an accounting of a real SIP where every instalment has its own
holding period.

## Track record — filtering out new funds

The explorer defaults to **3 years minimum history**, because a screener aimed at long-term holdings
should not surface funds whose entire record is one favourable stretch. Presets: Any / 1y+ / 3y+
(survived a drawdown) / 5y+ (a full cycle) / 10y+ (multiple cycles).

Getting a trustworthy age needed care, because neither obvious source is right on its own:

**Groww's `launch_date` is unusable.** Measured across 1,659 live schemes it holds only **20 distinct
values**, all inside the last 13 months, and funds with a populated 10-year return are stamped with
today's date. It is an ingestion timestamp. It is deliberately not ingested.

**An AMFI first-NAV date is a floor, not the truth.** Real inception dates come from the AMFI-derived
snapshot (98.5% join rate on scheme code, validated: Quantum funds resolve to 20.4 years, matching
their 2006 launch). But the date is per *plan*, and direct plans only began in January 2013 — scheme
119528 resolves to `2013-01-02` even though the scheme is far older. Using it alone would call a
twenty-year-old fund twelve years old.

**Return horizons are the most honest signal.** A populated 10Y return means ten years of history
whatever any date field says, and it measures the thing that actually matters — how much history is
available to judge — rather than mere calendar age.

So `trackRecordOf()` takes the **maximum** of the two, and `describeTrackRecord()` discloses the gap
when they disagree ("13 years of returns (direct plan since 3.0y ago)"). Cross-checked on live data:
median age by longest horizon is 13.6y for 10Y funds, 7.0y for 5Y, 3.8y for 3Y, 1.8y for 1Y.

Return-horizon inference is the **primary** signal and needs no external source, so the inception
enrichment is optional: if that fetch fails, the sync logs a warning and continues, and the filter
still works. Track record is also an independent gate on `hasSufficientData`, so a young fund with
decent short-horizon coverage still stays out of curated rankings.

## Redemption calculator

On each fund page: pick an amount and drag a holding period from 1 to 120 months, and see what you'd
actually keep after exit load and capital gains tax.

**The expense ratio is not subtracted.** TER is deducted from NAV daily, so it is already inside
every trailing return the projection compounds from — subtracting it again would double-count.

That claim is checkable rather than assumed. Across 23 direct-plan Nifty 50 index funds (identical
index by mandate, so TER is nearly the only difference), TER ranges 0.10% to 0.87% and 1Y return
ranges +0.09% to −0.71%. A TER spread of 0.77% produces a return spread of 0.80%, correlation
**−0.92** — essentially 1:1. If returns were gross of fees, that correlation would be ~0.

So TER appears as a *counterfactual* line instead: what the holding would have reached had the fund
charged nothing. Same information, correct direction.

Other deliberate choices:

- **6M return is never used to project.** It is an absolute period return while 1Y/3Y/5Y/10Y are
  CAGRs (verified on live data: a fund showing 1Y 0.09% shows 3Y 8.9% and 10Y 12.0%, coherent only as
  CAGRs). Compounding an absolute figure would roughly double short-horizon projections.
- **Extrapolation is labelled.** Projecting 10 years off a 1Y CAGR is flagged, not silently done.
- **Slab-taxed funds show `—`, not a guess.** Debt and hybrid short-term gains need your marginal
  rate; assuming 30% would be confidently wrong for anyone in a lower bracket.
- Single lump sum only. A real SIP has a separate holding period per instalment.

### Exit load parsing

The feed gives exit load as free English prose. [`exitLoad.ts`](src/utils/exitLoad.ts) handles four
real shapes, measured against 252 distinct live strings:

| Shape | Share | Example |
| --- | --- | --- |
| Flat | 60.3% | `Exit load of 1%, if redeemed within 15 days.` |
| Free-limit | 34.1% | `Exit load for units in excess of 10% of the investment, 1% will be charged for redemption within 1 year.` |
| Graded | 4.0% | `3% if redeemed within 1 year, 2% ... within 2 year, 1% ... within 3 year.` |
| Unparsed | 1.2% | source-data typos (`wirhin`), one inverted phrasing |

The free-limit form is the one that matters: a third of schemes use it, and the first 10-25% of units
redeem **free**. Applying the headline rate to the whole redemption overstates the cost by up to 10×.

Anything unparsed returns `kind: 'unknown'` and surfaces as "check the scheme document" rather than
defaulting to zero — silently reporting "no load" on a fund that charges one is the worst available
failure. Source-data typos are deliberately **not** fuzzy-matched; edit-distance matching on keywords
invites false positives across the 249 strings that already work.

## Data pipeline

```
Groww public API ──(local CLI only)──▶ public/data/funds.json ──▶ app
                                   └─▶ Firestore (fallback + user data)
```

The app reads a **committed static JSON file**, not Firestore. Serving ~3,000 funds as Firestore
documents costs one read per fund per cold client, which exhausts the free tier in about a dozen
first-time visits; one CDN-cached file costs nothing. Firestore remains for user data and as a
fallback.

Read precedence in [`getAllFunds`](src/services/firebaseService.ts): IndexedDB (6h TTL) → static
dataset → Firestore.

### Refreshing the data

Sync runs **only on your machine**. It cannot run in the browser in production (Groww's API sends no
CORS headers) and it is deliberately not in CI (no credentials there).

```bash
pnpm sync:data
```

Then commit and push — pushing to `main` triggers the deploy:

```bash
git add public/data/funds.json && git commit -m "chore: refresh fund data" && git push
```

`pnpm verify:dataset` runs in CI and fails the build if the file is missing, malformed,
schema-mismatched, or older than 45 days — so a silent fallback to Firestore becomes a red build
instead of a surprise bill.

Other sync modes:

```bash
pnpm sync:data:sample
```

```bash
pnpm sync:data:offline
```

Running `pnpm sync:data` with no arguments also offers a second option: upload the existing
`funds.json` straight to Firestore without re-fetching (~10s versus ~15-20 min).

## Who can change what

- **Writing fund data** requires a Firestore admin (email allowlist or `isAdmin: true`), and in
  practice only happens from a local sync — see [`firestore.rules`](firestore.rules).
- **Reading fund data from Firestore** requires sign-in. Anonymous visitors get the static dataset
  instead. A world-readable collection let anyone enumerate every document and drain the read quota.
- **Deploying** needs push access to `main`. The deploy workflow holds no Firebase credentials.
- **Per-user data** (`users/{uid}/**`) is owner-only, with no admin read.

## Running it yourself

Usable read-only with zero setup once `public/data/funds.json` exists. Firebase is only needed for
sign-in, admin config, and the Firestore fallback.

```bash
pnpm install
```

```bash
pnpm dev
```

To point it at your own Firebase project, edit [`src/lib/firebase.ts`](src/lib/firebase.ts) and the
admin email in [`firestore.rules`](firestore.rules), then deploy the rules:

```bash
firebase deploy --only firestore:rules
```

The Firebase web API key is not a secret — Firestore rules are what protect the data. It is still
worth moving to env vars if you want separate dev and prod projects.

### Checks

```bash
pnpm check
```

Runs typecheck, lint, and tests. `pnpm test` for watch mode. Tests cover the scoring engine, tax
classification, formatters, the cache TTL, and the Groww→model mapping. UI components and the sync
pipeline are not unit-tested — they need integration coverage.

## Tech stack

React 18 · TypeScript (strict) · Vite · Tailwind · shadcn/ui (Radix) · TanStack Query · Recharts ·
Firebase Auth + Firestore · Vitest

## Known limitations

- **Undocumented data source.** Groww's public API is not a contract; it can change shape or block
  access without notice. `pnpm verify:dataset` is the tripwire.
- **Survivorship bias.** Only currently open direct plans are fetched, so historical comparisons
  systematically exclude funds that closed or merged.
- **Point-in-time metrics only.** No NAV history is stored, so there are no rolling returns, no
  drawdown, and no independently computed volatility — everything is a Groww snapshot. This is the
  biggest gap; AMFI publishes daily NAV history for free.
- **No portfolio overlap analysis.** Five top-ranked large-cap funds may hold the same 20 stocks.
- **No fund manager tenure.** A 5Y record under a manager who left last year is noise. `fund_manager`
  is available on the feed but not yet ingested.
- **AUM is treated as neutral.** A small-cap fund with very large AUM may be unable to execute its
  mandate.

## Roadmap

1. Rewrite the SIP tracker on real persisted data; drop the continue/pause/stop verdicts.
2. Ingest AMFI NAV history → rolling returns, max drawdown, index comparison net of expense ratio.
3. Portfolio overlap between any two funds.
4. Real persistence for holdings and goals (Firestore rules are already in place).
5. Per-PAN long-term exemption headroom tracking across multiple accounts.
