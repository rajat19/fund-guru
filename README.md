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
| **Investment Builder** | ✅ Working | Rules + amount + risk + asset split → per-fund allocation, overlap-aware. Lumpsum or monthly SIP. See [below](#investment-builder). |
| **Evaluate Holdings** | ✅ Working | Upload holdings and/or SIP files — several at once, CSV or .xlsx — → ranking, keep/switch/trim verdicts costed against exit load and capital gains tax, overlap, stock look-through. Works signed out; saves to Firestore only on an explicit Save. See [below](#evaluate-holdings). |
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

## Investment Builder

Give it rules, an amount, a risk ceiling, a fund count and an asset split, and it produces a concrete
per-fund allocation.

Picking high-scoring funds is the easy part — that is just the existing ranking. The work is in what
turns a *list* of good funds into a *portfolio*:

**Overlap.** Five top-ranked large-cap funds hold largely the same twenty stocks. Diversifying across
funds is not diversifying across holdings, and a plan that ignores this gives a false sense of spread.
The builder computes weighted overlap — `Σ min(weight_A(stock), weight_B(stock))` — and skips a
candidate that overlaps an already-picked fund by more than 55%. Weighted rather than a count of
shared names, because sharing a 9% position matters far more than sharing a 0.2% one.

**Scheme minimums.** Observed minimums range ₹100 to ₹5,000. Splitting ₹50,000 ten ways lands at
₹5,000, exactly some funds' floor — so allocations that look fine on paper are not placeable. Any fund
whose share falls below its minimum is dropped and the money redistributed, iteratively, because
dropping one fund raises everyone else's share.

**Exact reconciliation.** Rounding each share independently leaves the total off by hundreds of
rupees. Amounts are split by largest-remainder so per-fund figures sum to the input exactly.

Diversification rules are relaxed in a deliberate order when a target cannot otherwise be met —
sub-category first, then AMC cap, and holdings overlap last, since it is the one that actually
protects against concentration. Every relaxation, drop and shortfall is reported in the plan's
warnings rather than silently applied.

Overlap needs [`holdings.json`](#data-pipeline); without it the builder falls back to sub-category and
AMC diversification and says so on screen. Overlap for an unknown pair is `null`, never `0` —
"we don't know" and "these share nothing" are opposite conclusions.

### Lumpsum vs SIP

The builder runs in either mode, and SIP is not a relabelled lumpsum — three
things genuinely differ:

**The binding minimum.** Across 1,556 live funds the median lumpsum minimum is
₹1,000 while the median SIP minimum is ₹200, and 880 funds set a lower SIP
minimum than lumpsum. At a ₹500 per-fund share, 674 funds are affordable by the
lumpsum rule against **1,349** by the SIP rule. Applying the lumpsum minimum to a
SIP would wrongly exclude half the universe.

**Not every scheme accepts one.** 27 of 1,659 sampled schemes report
`sip_allowed: false` — mostly target-maturity and gilt index funds, plus the newer
SIF category. SIP mode filters them out and says how many.

**Lock-in means something different.** Under a SIP every instalment locks from its
own date, so an ELSS holding is not free three years after you start — a rolling
portion stays locked until three years after your *final* instalment. The warning
says so in SIP mode.

What deliberately does **not** differ is the return basis. The feed exposes SIP
XIRR under both `sip_returnNy` and `sipReturnNy`, and neither is usable: the
camelCase set reports an identical value for 3Y and 5Y in **100%** of sampled
funds (775/775), and the two casings disagree on **every** fund (0/769 agree).
Ranking therefore uses lumpsum trailing returns in both modes — imperfect for a
SIP, and better than a number that cannot be read.

### Minimum per fund — a default, not a rule

Scheme minimums are facts; a floor on how small a slice is worth holding is an
opinion, so it is an adjustable input (`minPerFund`) rather than a constant.

Some floor is needed — at scheme minimums alone a ₹1,000/month SIP splits ten ways
at ₹100 each. But a hard floor has real cost. Measured on the live universe, funds
placed and smallest slice for a 70/30 SIP at `fundCount: 6`:

| Monthly | No floor | ₹500 | ₹1,000 (SIP default) |
| --- | --- | --- | --- |
| ₹1,000 | 6 / ₹100 | 1 / ₹700 | 0 |
| ₹2,000 | 6 / ₹300 | 3 / ₹600 | 1 / ₹1,400 |
| ₹5,000 | 6 / ₹700 | 6 / ₹700 | 4 / ₹1,100 |
| ₹25,000 | 6 / ₹3,700 | 6 / ₹3,700 | 6 / ₹3,700 |

Defaults are **₹1,000 for a SIP and none for a lumpsum**. They differ because
every SIP instalment is a separate acquisition lot for capital gains — four funds
is 48 lots a year and 480 over a decade — whereas a lumpsum slice is a one-off
with no such tail.

Warnings distinguish *which* limit bound the fund count, since one is changeable
and the other is not: "supports 2 funds under your ₹1,000 per-fund floor" versus
"under SIP scheme minimums". And when the floor blocks every class — which a 70/30
split at ₹1,000/month does, leaving debt ₹300 — a single plain sentence names the
three ways out rather than leaving the user with several unexplained shortfalls.

### Affordability before selection

Fund selection is greedy on score and blind to money, which used to produce
underfunded classes. Observed on real data: a ₹1,500 debt share picked the
top-scoring debt fund, found it needed ₹5,000, dropped it, and left the class with
**nothing** — while 442 other debt funds would have accepted ₹1,500.

So the builder now works out the largest fund count each class can support at
scheme minimums, and filters the pool to funds that clear the resulting per-fund
share, before ranking. Fewer funded funds beat more unfunded ones. On a
₹3,000/month SIP this is the difference between 30% of the money sitting
unallocated and all of it being placed.

### Stock-level holdings

The holdings the builder compares come from the **same v4 search response the sync already fetches**,
so collecting them costs no extra requests. Two notes on that data:

- The `portfolio/stats` endpoint only exposes concentration percentages (`top_five_corpus_per` and
  friends), not stock names. The names are on the search endpoint under `holdings`, with
  `company_name`, `sector_name`, `corpus_per` and a `stock_search_id` slug that joins cleanly across
  funds — company names do not (`HDFC Bank Ltd` vs `HDFC Bank Limited`).
- Only the **top 20 per fund** are stored, in a separate `holdings.json` rather than the main dataset.
  The top 20 cover 80-99% of a fund's corpus, which is ample for judging whether two funds are the
  same bet, and keeping them out of `funds.json` avoids making every first page load pay ~2.8 MB for a
  feature most visits never reach.

## Evaluate Holdings

Upload what you hold and what you are adding to each month. Either file alone is enough — they are
independent.

The builder answers "where should this money go?". This answers a harder question, because **buying
is free and leaving is not**. A position carries an embedded gain, a capital gains clock and possibly
an unexpired exit load, so "this fund is mediocre" is not on its own a reason to move. Three
principles follow.

### 1. Existing units and future instalments get different bars

Redirecting a SIP costs nothing: no load, no tax, nothing realised — the next instalment simply goes
elsewhere. Selling units costs real money. So the same fund can honestly warrant **"keep what you
hold, stop adding to it"**, and holdings and SIPs are therefore evaluated separately with different
thresholds rather than collapsed into one verdict per fund.

Verdicts are `keep` / `keep for now` / `trim` / `worth switching` for holdings, and
`continue` / `review` / `redirect` for SIPs. There is deliberately no "stop" for a SIP: stopping
without redirecting changes how much you invest and your asset mix, which is a decision about your
plan, and this knows nothing about your plan.

### 2. A switch has to pay for itself

Every "worth switching" clears two independent tests, not one:

1. A fund in the same sub-category that you **do not already hold** ranks at least 15 percentile
   points higher.
2. The load plus tax is either negligible (≤1% of the position) or recovered by the return gap within
   two years.

Exit load reuses the [parser](#exit-load-parsing) — including the "first 10% of units are free" form,
which a naive rate × value overstates by up to 10× — and tax reuses the one dated
[rate table](#tax-layer), so the long-term exemption and the slab-taxed buckets behave correctly.

**The two clocks are counted in different units, deliberately.** Capital gains thresholds are written
in months from the acquisition date, so tax uses completed *calendar* months — day-arithmetic with an
average 30.44-day month makes 365 days read as 11.99 and floor to 11, which would apply 20%
short-term tax to a holding that is exactly a year old. Exit load windows are mostly written in
**days**: measured on the live dataset, 408 of the 882 schemes that charge a load use a window under
a month, with 7, 15 and 30 days dominating. Rounding those to whole months charges a 20-day-old
holding a 15-day load it has already escaped, so exit load is evaluated on the exact day count via
`applyExitLoadForDays`. `applyExitLoad` remains for the redemption calculator, whose input really is
a whole number of months, and its doc comment says what it loses.

A position still being fed by a SIP is flagged rather than mis-costed: it is one lot per instalment,
each with its own load window and gains clock, while the file gives a single purchase date. The
switch cost is computed as though it were one lot bought then, which *understates* it, and the row
says so.

The
break-even figure is `cost% ÷ annual return gap`, which assumes the trailing gap persists; that is an
assumption, not a forecast, so the verdict text always names the gap and the horizon it came from.

Where the cost cannot be computed the verdict stops short rather than guessing:

| Missing input | Effect |
| --- | --- |
| No purchase date | No exit load or capital gains figure; a laggard reads "keep for now", saying why |
| No cost figure | Gain unknown, so the tax on a switch is unknown |
| Debt/hybrid with no marginal rate set | Cost shown as unknown, never assumed at 30% |

It also quantifies **waiting**: a holding three months short of long-term treatment reports what those
three months save on today's gain.

### 3. Peer standing excludes the risk tilt

The headline peer score multiplies by a risk factor, which is right for shortlisting across the
universe and wrong here — it would mark every small-cap holding down 10% and every liquid-fund holding
up 10%, so your equity funds would look like laggards purely for being equity, an exposure you chose.
So verdicts use `measuredScore`, the untilted percentile within the fund's own sub-category. Within a
sub-category the tilt is uniform anyway, so nothing is lost.

### Index funds are not judged on peer standing

A tracker scored against active peers trails them whenever active managers beat the index, because
alpha, Sharpe and information ratio are all measured against the very benchmark it replicates.
Reporting "bottom 35% of Large Cap, 41 funds rank higher, worth switching" is the metric misapplied,
and it would push someone out of a defensible strategy on an arithmetic artefact. (This was caught on
real data — a Nifty 50 index fund was being flagged for exit.)

So peer standing is still shown for a passive holding and never used to justify leaving it. What
applies instead is cost: funds reporting the identical `benchmarkName` are compared on expense ratio,
which on live data surfaces things like a 0.19% Nifty 50 fund against a 0.07% one tracking the same
index. Duplication still counts — owning the index twice is real.

### What else it reports

- **Overlap between your own funds**, using the same weighted measure as the builder. Two holdings
  above 60% shared are a duplication, and the lower-ranked half is the switch candidate.
- **Stock look-through** — every fund's disclosed holdings weighted by the money you have in it, so
  eight funds resolving to 72 companies with the top 10 at 25% is visible. Labelled with its coverage,
  since only the top 20 per fund are published.
- **Concentration** by fund and by AMC. Both are gated on having enough holdings for concentration to
  be a *choice*: with four funds an equal split is already 25% each, so the per-fund guard requires an
  equal split to fall below the threshold rather than flagging arithmetic as a problem.
- **Allocation drift** against a target you pick. Unset by default — reporting drift against a
  benchmark nobody chose would be inventing it and then judging against it. Drift is also cheaper to
  correct with new money than by selling, and the text says so.
- **Annual fee cost in rupees**, since a money-weighted 0.32% is abstract and "₹365 a year" is not.

### Reading the files

There is no standard export, so nothing about the layout is assumed. Columns are matched by name
against an alias table (`Current Value`, `Market Value`, `Valuation`, `Present Value (₹)` all work),
never by position, and the header row is *found* rather than assumed — real exports lead with a title,
an account number and a blank line. `Amount` deliberately means cost in a holdings file and instalment
in a SIP file; swapping them would report a nonsense return.

**Several files at once**, because one portfolio is often several accounts — a broker export plus a
registrar statement, or one file per family member.

**Files are staged, then analysed on one explicit Generate.** Each file is read and validated as it is
picked, because column mapping, skipped rows and parse errors are feedback about *that file* and
withholding them until the end would make a bad upload hard to attribute. But nothing reaches the
analysis until the button is pressed.

That split is not about saving work. Portfolio-level figures — allocation, AMC concentration, overlap,
ranking — are only meaningful over a *complete* portfolio, so recomputing as each file lands would put
"62% of your portfolio is with one fund house" on screen when two of three accounts have been read: a
confident, wrong, actionable number. One deterministic transition means a half-portfolio verdict is
never rendered at all. Generate replaces both lists wholesale, and the staged summary says how many
files and rows are about to be analysed.

Clubbing is where double-counting gets in, and the two ways it happens need opposite handling:

| Case | Handling | Why |
| --- | --- | --- |
| The **same row** in two files (a statement uploaded twice) | Dropped, and counted in the report | The rows are identical, so nothing is lost |
| The **same position restated** — same fund and folio, different units (a January file and an August one) | First kept, collision **reported** naming both files | Summing invents money that does not exist; dropping silently picks a version |
| Repeated fund+folio **within one file** | Both kept | A transaction-level statement lists one row per purchase, and each has its own acquisition date and so its own tax lot |
| Same fund, **different folio** | Both kept | Genuinely separate positions |
| Same fund, **no folio** to tell them apart | Both kept | With nothing to identify a restatement by, dropping would be a guess |

**.xlsx is read directly**, with no dependency. SheetJS on npm is stuck at 0.18.5 with known
prototype-pollution advisories (the fixed builds are only on the maintainer's own CDN), and ExcelJS is
about a megabyte on a page this app otherwise keeps lean — while the platform now supplies the hard
part, since `DecompressionStream('deflate-raw')` does the inflate. What is left is the zip directory
and a little XML.

Two things make .xlsx harder than it looks, and both are handled:

- **Dates are numbers.** A purchase date arrives as `45397`, and whether that is a date or a quantity
  is recorded in the cell's *style*, not the cell. So `styles.xml` is parsed and serials are converted
  only for date-formatted cells — a currency-formatted `44813.5` stays a number. The epoch is
  1899-12-30, not 1900-01-01, because Excel is bug-compatible with Lotus 1-2-3 over the 1900 leap
  year; using the obvious date puts everything two days out.
- **The first sheet is usually not the data.** Workbooks lead with "Summary" or "Disclaimer", so every
  sheet is scored on how many columns its header maps and how many rows follow, and the best one wins.

Two parsing details that are easy to get silently wrong:

Two parsing details that are easy to get silently wrong:

- **`Number('')` is 0.** An empty cost cell coerced that way becomes a free holding with an infinite
  gain, so figures parse to `null` instead. Lakh grouping (`1,23,456.78`), `₹`, `Rs.`, `/-` and the
  accounting negative `(1,200)` are all handled.
- **`03/04/2024` is ambiguous** and the capital gains clock turns on which reading is right. Day-first
  is assumed, matching Indian convention, and the import *says* how many dates that applied to. Where
  only one reading is possible (`15/04`), no assumption is reported.

Scheme names are matched on token similarity with two guards: a floor below which nothing is accepted,
and an **ambiguity check** that rejects a winner the runner-up nearly tied with — a row reading only
"Small Cap Fund" fits two hundred schemes and must not silently resolve to whichever sorted first. It
reports the near-miss instead ("matches Bandhan Small Cap and ITI Small Cap about equally well").
Measured against all 1,529 real scheme names, 48/48 rewritings matched — uppercased, regular-plan,
re-punctuated, truncated and `- Direct Plan - Growth Option` forms.

Because the dataset holds direct plans only, a **regular-plan row is matched to the direct plan of the
same scheme** and flagged: the expense ratio shown is the direct one and is lower than what you are
paying.

Every skipped row is reported with its line number, its reason and **how much money was on it** — a
silently short import would make every percentage on the page look like it covered the whole
portfolio.

### Storage

Signed out, **nothing is stored anywhere** — not on the server and not in browser storage either. This
is somebody's whole financial position, and leaving it in localStorage on a possibly shared machine is
a worse default than making them pick the file again. Refreshing clears it, and the page says so.

Signed in, Save writes one owner-only document to `users/{uid}/holdings/snapshot` under the existing
rules. It is written on an explicit Save only, never on import or edit, so uploading a file to look at
something is not the same as filing it away. There is a delete, and it says what it removes.

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
Groww public API ──(local CLI only)──▶ public/data/funds.json    ──▶ app
                                   ├─▶ public/data/holdings.json ──▶ builder (lazy)
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

It writes two files and, by default, **does not touch Firestore**:

```bash
pnpm sync:data
```

Then commit and push — pushing to `main` triggers the deploy:

```bash
git add public/data/funds.json && git commit -m "chore: refresh fund data" && git push
```

`pnpm verify:dataset` runs in CI and fails the build if the file is missing, malformed,
or older than 45 days — so a silent fallback to Firestore becomes a red build
instead of a surprise bill.

### No dataset schema version

There deliberately is not one. The published files carry `generatedAt` and nothing
else identifying them.

A hand-maintained version number was tried and removed. Every new optional field
meant bumping it, and because both readers compared with strict equality, each
bump broke CI and made the running app silently fall back to Firestore — at one
read per fund per cold client — until a fresh ~4 MB sync was committed. That
coupled every code release to a data release and told nobody anything.

`generatedAt` already does the useful part: it changes on every sync, which is
what invalidates the browser cache. And every field is optional with readers that
handle absence, so an older file degrades rather than breaks. What CI checks
instead is the data itself — is it a dataset envelope, does it parse, is it recent,
do the fields the builder needs actually appear — which is both more honest and
more useful than a number.

### Why the sync no longer writes Firestore by default

It used to, costing ~1,541 reads (the stale-doc sweep scans the whole collection) plus ~1,541 writes
on every sync, and it was the only reason the sync needed Firebase credentials.

That fallback is close to unreachable now: CI refuses to ship a build whose `funds.json` is missing or
malformed, and Firestore reads require sign-in, so an anonymous visitor never gets there. It is also
only a *partial* fallback — `holdings.json` has no Firestore mirror, so a visitor who fell back would
lose overlap analysis regardless.

So it is opt-in:

```bash
pnpm sync:data:firebase
```

Worth running if you want the fallback warm before a risky deploy, or if something other than this app
ever needs to read the data server-side. Otherwise skip it.

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

- **Writing fund data** requires a Firestore admin (email allowlist or `isAdmin: true`), and only
  happens when you explicitly run `pnpm sync:data:firebase` — see [`firestore.rules`](firestore.rules).
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
classification, exit load parsing, the investment builder, holdings evaluation, CSV and .xlsx reading,
statement parsing, multi-file merging, scheme-name matching, formatters, the cache TTL, and the
Groww→model mapping. The .xlsx reader is tested against a real deflated workbook fixture rather than a
mock, since the things that break such a reader — date-styled serials, sparse rows, rich-text shared
strings — only exist in a genuine file. UI components and the sync pipeline are not unit-tested — they
need integration coverage.

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
- **No fund manager tenure.** A 5Y record under a manager who left last year is noise. `fund_manager`
  is available on the feed but not yet ingested.
- **AUM is treated as neutral.** A small-cap fund with very large AUM may be unable to execute its
  mandate.

## Roadmap

1. Rewrite the SIP tracker on real persisted data; drop the continue/pause/stop verdicts.
2. Ingest AMFI NAV history → rolling returns, max drawdown, index comparison net of expense ratio.
3. Portfolio overlap between any two funds.
4. Real persistence for goals. Holdings are done — see [Evaluate Holdings](#evaluate-holdings).
5. Per-PAN long-term exemption headroom tracking across multiple accounts. Evaluate Holdings takes the
   remaining headroom as an input; nothing tracks it across accounts yet.
6. Parse a CAS PDF directly. The holdings importer reads CSV and .xlsx, so a PDF statement still needs
   an export step first.
