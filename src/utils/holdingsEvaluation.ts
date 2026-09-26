import { MutualFund } from '@/types/mutualFund';
import {
  INSTALMENTS_PER_YEAR,
  type MfHolding,
  type SipHolding,
} from '@/types/userHoldings';
import {
  peerGroupKey,
  rankFundsWithContext,
  scoreFund,
  type ScoreBreakdown,
  type ScoringContext,
} from '@/utils/scoringEngine';
import { overlapPercent, type HoldingsIndex } from '@/utils/overlap';
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABEL,
  classifyAssetClass,
  normaliseAllocation,
  type AssetAllocation,
  type AssetClass,
} from '@/utils/assetClass';
import { applyExitLoadForDays, exitLoadPolicyFor, type AppliedExitLoad } from '@/utils/exitLoad';
import { postTaxReturn, taxProfile } from '@/utils/taxation';
import { toNumber } from '@/utils/number';
import { trackRecordOf } from '@/utils/trackRecord';

/**
 * Evaluating a portfolio someone already owns
 * ==========================================
 *
 * The investment builder answers "where should this money go?". This answers a
 * harder question — "what should I do with what I already hold?" — and the
 * difference is not cosmetic. Buying is free; **leaving is not.** A holding
 * carries an embedded gain, a capital gains clock, and possibly an unexpired exit
 * load, so "this fund is mediocre" is not on its own a reason to move. The cost
 * of moving has to be weighed against the gap being closed.
 *
 * Three principles follow from that, and they shape everything below.
 *
 * **1. Existing units and future instalments get different bars.**
 * Redirecting a SIP costs nothing at all: no load, no tax, no realised gain — the
 * next instalment simply goes elsewhere. Selling units costs real money. So the
 * same mediocre fund can honestly warrant "stop sending it new money" and "not
 * worth selling what you hold", simultaneously. Collapsing the two into one
 * verdict per fund would be wrong in one direction or the other every time,
 * which is why MF holdings and SIPs are evaluated separately here.
 *
 * **2. Peer standing is measured without the risk tilt.**
 * The app's headline peer score multiplies by a risk factor, which is right for
 * shortlisting across the universe and wrong here: it would mark every small-cap
 * holding down 10% and every liquid-fund holding up 10%, so a user's equity funds
 * would look like laggards purely for being equity — an exposure they chose on
 * purpose. So verdicts use `measuredScore`, the untilted weighted percentile
 * within the fund's own sub-category. Within a sub-category the tilt is uniform
 * anyway, so comparing a fund to its own peers is unaffected.
 *
 * **3. Nothing is judged that cannot be judged.**
 * A fund with too little data, a holding with no purchase date, an unmatched row —
 * each yields an explicit "not judged, and here is what is missing" rather than a
 * verdict resting on absent inputs.
 *
 * Everything here is arithmetic over the published dataset and the user's own
 * numbers. No model, no forecast, and not advice.
 */

/* ---------------------------------------------------------------------------
 * Thresholds
 *
 * All of them live here, named, so the judgement is inspectable rather than
 * scattered through the logic as bare numbers.
 * ------------------------------------------------------------------------- */

/**
 * Peer standing below which a fund is in the weaker half of its sub-category by
 * enough to matter. Set at 40 rather than 50 so ordinary mid-pack funds are not
 * all labelled problems — at any moment half of every category is below median,
 * and calling half a portfolio a laggard is noise, not information.
 */
export const WEAK_STANDING = 40;

/** Peer standing at or above which a fund is comfortably in the better half. */
export const STRONG_STANDING = 60;

/**
 * Percentile points a replacement must beat the holding by before it is worth
 * mentioning. Small gaps are within the noise of the metrics themselves.
 */
export const MATERIAL_STANDING_GAP = 15;

/** Overlap at which two funds are substantially the same bet. */
export const DUPLICATE_OVERLAP_PERCENT = 60;

/** Overlap worth reporting even though it falls short of duplication. */
export const NOTABLE_OVERLAP_PERCENT = 45;

/** Share of the portfolio in one fund above which concentration is flagged. */
export const OVERWEIGHT_FUND_PERCENT = 25;

/** Share of the portfolio with one AMC above which concentration is flagged. */
export const OVERWEIGHT_AMC_PERCENT = 40;

/**
 * Concentration is only a *choice* once there are enough holdings for it to be
 * one. With four funds an equal split is already 25% each, so flagging the
 * threshold would report arithmetic as a problem — and telling someone with one
 * fund that 100% of their portfolio is in one fund is noise. The per-fund guard
 * is therefore derived from the threshold itself (an equal split must fall below
 * it), and the AMC guard uses a plain floor.
 */
const concentrationIsMeaningful = (valuedCount: number): boolean =>
  valuedCount * OVERWEIGHT_FUND_PERCENT > 100;

const MIN_HOLDINGS_FOR_AMC_CONCENTRATION = 3;

/**
 * Switch cost, as a share of the position, treated as small enough to ignore.
 * Below this the decision is about the funds, not the tax.
 */
export const NEGLIGIBLE_SWITCH_COST_PERCENT = 1;

/** Years to recoup a switch cost within which switching pays for itself soon. */
export const QUICK_BREAK_EVEN_YEARS = 2;

/** Percentage points a fund must trail its own category average by to count. */
export const CATEGORY_LAG_POINTS = 1.5;

/** Allocation drift, in percentage points, worth reporting. */
export const ALLOCATION_DRIFT_POINTS = 10;

/* ---------------------------------------------------------------------------
 * Result shapes
 * ------------------------------------------------------------------------- */

export type SignalKind =
  | 'peer-standing'
  | 'category-lag'
  | 'cost'
  | 'overlap'
  | 'duplicate-row'
  | 'concentration'
  | 'thin-data'
  | 'lock-in'
  | 'exit-window'
  | 'tax-timing'
  | 'loss'
  | 'plan';

export type SignalTone = 'good' | 'neutral' | 'warn' | 'bad';

export interface Signal {
  kind: SignalKind;
  tone: SignalTone;
  message: string;
}

/** What leaving a position would cost today. */
export interface SwitchCost {
  exitLoad: AppliedExitLoad;
  exitLoadAmount: number;
  /** Capital gains tax on today's gain. Null when the bucket needs a slab rate. */
  taxAmount: number | null;
  /** Load plus tax. Null whenever the tax is null. */
  totalAmount: number | null;
  /** The total as a share of the current value. */
  percentOfValue: number | null;
  isLongTerm: boolean;
  monthsToLongTerm: number;
  /**
   * Tax avoided by waiting until the holding turns long-term, on today's gain.
   * Not a projection — it deliberately does not grow the gain forward.
   */
  savingByWaiting: number | null;
  notes: string[];
}

/** A higher-ranked fund in the same sub-category. */
export interface BetterPeer {
  fund: MutualFund;
  /** Peer standing of the alternative, on the same untilted scale. */
  standing: number;
  standingGap: number;
  /** Annualised return advantage over the holding, in points. Null if unknown. */
  annualAdvantage: number | null;
  /** Which horizon the advantage was measured over. */
  advantageBasis: '3Y' | '5Y' | '1Y' | null;
  expenseRatioDelta: number | null;
  /** How many funds in the sub-category clear the same bar. */
  betterCount: number;
}

export interface OverlapWith {
  holdingId: string;
  schemeName: string;
  percent: number;
  /** True when the other side of the pair has the better peer standing. */
  otherRanksHigher: boolean;
}

export type HoldingVerdict = 'buy' | 'keep' | 'watch' | 'trim' | 'exit' | 'unjudged';

export const HOLDING_VERDICT_LABEL: Record<HoldingVerdict, string> = {
  buy: 'Buy / Strong Hold',
  keep: 'Hold',
  watch: 'Hold (Costly to switch)',
  trim: 'Sell (Partial)',
  exit: 'Sell',
  unjudged: 'Not judged',
};

export interface EvaluatedHolding {
  holding: MfHolding;
  fund: MutualFund | null;
  breakdown: ScoreBreakdown | null;
  /**
   * Untilted weighted percentile within the fund's own sub-category. The number
   * every verdict here is based on. Null when the fund could not be resolved.
   */
  standing: number | null;
  /** Position among the user's own matched holdings, 1 = best standing. */
  rank: number;
  invested: number | null;
  currentValue: number | null;
  gain: number | null;
  gainPercent: number | null;
  /** Share of the evaluated portfolio by current value. */
  weightPercent: number;
  holdingMonths: number | null;
  assetClass: AssetClass | null;
  /** Average of the fund's excess over its own category across 1Y/3Y/5Y. */
  categoryExcess: number | null;
  switchCost: SwitchCost | null;
  betterPeer: BetterPeer | null;
  /**
   * Years for the better peer's return advantage to recover the switch cost.
   * Zero when leaving is free. Null when either side is unknown.
   */
  breakEvenYears: number | null;
  worstOverlap: OverlapWith | null;
  /** True for index funds and ETFs, which peer standing does not fairly judge. */
  isPassive: boolean;
  /** Same-benchmark scheme with a materially lower fee, for passive holdings. */
  cheaperTracker: CheaperTracker | null;
  signals: Signal[];
  verdict: HoldingVerdict;
  verdictReason: string;
}

export type SipVerdict = 'continue' | 'review' | 'redirect' | 'unjudged';

export const SIP_VERDICT_LABEL: Record<SipVerdict, string> = {
  continue: 'Continue',
  review: 'Review',
  redirect: 'Redirect future instalments',
  unjudged: 'Not judged',
};

export interface EvaluatedSip {
  sip: SipHolding;
  fund: MutualFund | null;
  breakdown: ScoreBreakdown | null;
  standing: number | null;
  rank: number;
  /** Instalment normalised to a monthly figure. Null when frequency is unknown. */
  monthlyEquivalent: number | null;
  /** Share of the monthly commitment this SIP represents. */
  weightPercent: number;
  assetClass: AssetClass | null;
  categoryExcess: number | null;
  betterPeer: BetterPeer | null;
  /** Overlap against another SIP, or against an existing holding. */
  worstOverlap: OverlapWith | null;
  isPassive: boolean;
  cheaperTracker: CheaperTracker | null;
  signals: Signal[];
  verdict: SipVerdict;
  verdictReason: string;
}

export interface AllocationRow {
  assetClass: AssetClass;
  amount: number;
  currentPercent: number;
  targetPercent: number | null;
  /** Current minus target, in points. Null without a target. */
  driftPoints: number | null;
}

export interface ConcentrationRow {
  label: string;
  amount: number;
  percent: number;
  fundCount: number;
}

export interface OverlapPairRow {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  percent: number;
  /** Money sitting in the pair, so the size of the duplication is visible. */
  combinedAmount: number | null;
}

/**
 * The portfolio's real stock-level exposure.
 *
 * Fund-level diversification hides this: eight funds can be one bet. Only the
 * top 20 holdings per fund are published, so weights sum to 80-99% of each
 * fund's corpus rather than 100 — `coveragePercent` says how much of the money
 * this could see at all.
 */
export interface LookThrough {
  coveragePercent: number;
  uniqueIssuers: number;
  top: Array<{ name: string; percent: number }>;
  topTenPercent: number;
}

export type SuggestionSeverity = 'good' | 'info' | 'warn' | 'bad';

export interface Suggestion {
  id: string;
  severity: SuggestionSeverity;
  title: string;
  detail: string;
}

export interface PortfolioTotals {
  invested: number | null;
  currentValue: number | null;
  gain: number | null;
  gainPercent: number | null;
  rowCount: number;
  /** Rows tied to a fund in the dataset, and so actually analysable. */
  matchedCount: number;
}

export interface SipTotals {
  monthlyTotal: number | null;
  annualTotal: number | null;
  activeCount: number;
  /** Monthly money going into funds in the weaker part of their sub-category. */
  monthlyIntoWeak: number | null;
}

export interface PortfolioEvaluation {
  holdings: EvaluatedHolding[];
  sips: EvaluatedSip[];
  totals: PortfolioTotals;
  sipTotals: SipTotals;
  /** Money-weighted expense ratio of the holdings. */
  weightedExpenseRatio: number | null;
  /** What that expense ratio costs a year, in rupees. */
  annualCostRupees: number | null;
  /** Money-weighted peer standing. */
  weightedStanding: number | null;
  allocation: AllocationRow[];
  amcConcentration: ConcentrationRow[];
  subCategoryConcentration: ConcentrationRow[];
  overlapPairs: OverlapPairRow[];
  lookThrough: LookThrough | null;
  suggestions: Suggestion[];
  /** Data-quality caveats that qualify every figure above. */
  notes: string[];
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Completed *calendar* months between a purchase date and now.
 *
 * Calendar months, not days divided by an average month length. That average is
 * 30.44 days, so 365 days works out to 11.99 months and floors to 11 — which
 * would report a holding bought exactly a year ago as short-term and apply 20%
 * tax where the correct answer is 12.5% with an exemption. The capital gains
 * thresholds in the Act are expressed in months from the acquisition date, so
 * that is what this counts.
 */
export const holdingMonthsSince = (
  isoDate: string | null,
  now: Date = new Date(),
): number | null => {
  if (!isoDate) return null;
  const start = new Date(isoDate);
  if (Number.isNaN(start.getTime())) return null;
  if (start.getTime() > now.getTime()) return null;

  const months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth());

  // The month is only complete once the day-of-month has come round again.
  return Math.max(0, now.getUTCDate() < start.getUTCDate() ? months - 1 : months);
};

/**
 * Exact days held.
 *
 * Kept separate from the month count because the two are used for genuinely
 * different things and neither substitutes for the other. Capital gains
 * thresholds are written in months from the acquisition date, so tax uses
 * `holdingMonthsSince`. Exit load windows are mostly written in *days* — 7, 15
 * and 30 dominate the live data — so rounding to whole months would charge a
 * 20-day-old holding a 15-day load it has already escaped.
 */
export const holdingDaysSince = (
  isoDate: string | null,
  now: Date = new Date(),
): number | null => {
  if (!isoDate) return null;
  const start = new Date(isoDate);
  if (Number.isNaN(start.getTime())) return null;

  const days = Math.floor((now.getTime() - start.getTime()) / MS_PER_DAY);
  return days < 0 ? null : days;
};

/** Average excess over the fund's own category across the horizons we have. */
const categoryExcessOf = (fund: MutualFund): number | null => {
  const pairs: Array<[number | null | undefined, number | null | undefined]> = [
    [fund.returns.oneYear, fund.categoryReturns.cat1y],
    [fund.returns.threeYear, fund.categoryReturns.cat3y],
    [fund.returns.fiveYear, fund.categoryReturns.cat5y],
  ];

  const excesses = pairs
    .map(([own, cat]) => {
      const a = toNumber(own);
      const b = toNumber(cat);
      return a == null || b == null ? null : a - b;
    })
    .filter((value): value is number => value != null);

  return excesses.length === 0
    ? null
    : excesses.reduce((sum, value) => sum + value, 0) / excesses.length;
};

/** Comparable trailing return for two funds, longest horizon both share. */
const sharedReturn = (
  a: MutualFund,
  b: MutualFund,
): { advantage: number; basis: '3Y' | '5Y' | '1Y' } | null => {
  const horizons: Array<['5Y' | '3Y' | '1Y', keyof MutualFund['returns']]> = [
    ['5Y', 'fiveYear'],
    ['3Y', 'threeYear'],
    ['1Y', 'oneYear'],
  ];

  for (const [basis, key] of horizons) {
    const mine = toNumber(a.returns[key]);
    const theirs = toNumber(b.returns[key]);
    if (mine != null && theirs != null) return { advantage: theirs - mine, basis };
  }
  return null;
};

/**
 * What leaving the position would cost today.
 *
 * Exit load and capital gains tax are both reused from the modules that already
 * model them, rather than reimplemented — the exit load parser handles the
 * "first 10% of units are free" form that a naive rate × value would overstate
 * tenfold, and the tax module holds the one dated rate table.
 */
export const switchCostOf = (
  fund: MutualFund,
  input: {
    invested: number | null;
    currentValue: number | null;
    /** Completed calendar months, for the capital gains thresholds. */
    holdingMonths: number | null;
    /**
     * Exact days held, for the exit load window. Falls back to the month count
     * when absent, which is lossy for the sub-month windows most schemes use.
     */
    holdingDays?: number | null;
    slabRatePercent?: number;
    exemptionHeadroomRupees?: number;
  },
): SwitchCost | null => {
  const { currentValue, invested, holdingMonths } = input;
  if (currentValue == null || currentValue <= 0 || holdingMonths == null) return null;

  const notes: string[] = [];

  // Days where we have them: a 15-day window cannot be evaluated in whole months.
  const days = input.holdingDays ?? holdingMonths * 30.44;
  const applied = applyExitLoadForDays(exitLoadPolicyFor(fund), days);
  const exitLoadAmount = currentValue * applied.chargeableFraction * (applied.ratePercent / 100);

  if (applied.uncertain) {
    notes.push(
      'Exit load terms could not be read, so no load is included here. Check the scheme document.',
    );
  }

  const gain = invested == null ? null : currentValue - invested;
  const gainPercent = invested != null && invested > 0 ? ((currentValue - invested) / invested) * 100 : 0;

  const tax = postTaxReturn(fund, {
    grossReturnPercent: gainPercent,
    holdingMonths,
    slabRatePercent: input.slabRatePercent,
    gainRupees: gain != null && gain > 0 ? gain : undefined,
    exemptionHeadroomRupees: input.exemptionHeadroomRupees,
  });

  let taxAmount: number | null;
  if (gain == null) {
    taxAmount = null;
    notes.push('No cost figure for this holding, so the capital gains tax on a switch is unknown.');
  } else if (gain <= 0) {
    taxAmount = 0;
    notes.push('The position is at a loss, so no capital gains tax would arise on a switch.');
  } else if (Number.isNaN(tax.effectiveRatePercent)) {
    taxAmount = null;
    notes.push(
      `${taxProfile(fund).rules.label} gains here are taxed at your slab rate — set a marginal rate to see what a switch would cost.`,
    );
  } else {
    taxAmount = gain * (tax.effectiveRatePercent / 100);
  }

  // What waiting for the long-term threshold would save, on today's gain.
  let savingByWaiting: number | null = null;
  if (gain != null && gain > 0 && tax.monthsToLongTerm > 0 && taxAmount != null) {
    const threshold = holdingMonths + tax.monthsToLongTerm;
    const later = postTaxReturn(fund, {
      grossReturnPercent: gainPercent,
      holdingMonths: threshold,
      slabRatePercent: input.slabRatePercent,
      gainRupees: gain,
      exemptionHeadroomRupees: input.exemptionHeadroomRupees,
    });
    if (!Number.isNaN(later.effectiveRatePercent)) {
      savingByWaiting = Math.max(0, taxAmount - gain * (later.effectiveRatePercent / 100));
    }
  }

  if (applied.daysUntilFree > 0 && applied.ratePercent > 0) {
    notes.push(
      `Still inside the exit load window — ${applied.daysUntilFree} more day${applied.daysUntilFree === 1 ? '' : 's'} until it lapses.`,
    );
  }

  const totalAmount = taxAmount == null ? null : exitLoadAmount + taxAmount;

  return {
    exitLoad: applied,
    exitLoadAmount,
    taxAmount,
    totalAmount,
    percentOfValue: totalAmount == null ? null : (totalAmount / currentValue) * 100,
    isLongTerm: tax.isLongTerm,
    monthsToLongTerm: tax.monthsToLongTerm,
    savingByWaiting,
    notes,
  };
};

/** Cached, ranked peer groups so a portfolio of 20 funds ranks each group once. */
class PeerGroups {
  private cache = new Map<string, MutualFund[]>();

  constructor(
    private universe: MutualFund[],
    private context: ScoringContext,
  ) {}

  /** Funds in the same sub-category with enough data to rank, best first. */
  ranked(fund: MutualFund): MutualFund[] {
    const key = peerGroupKey(fund);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const peers = this.universe.filter((candidate) => peerGroupKey(candidate) === key);
    const ranked = rankFundsWithContext(peers, this.context);
    this.cache.set(key, ranked);
    return ranked;
  }
}

/**
 * The best-ranked fund in the same sub-category that beats this holding by a
 * material margin.
 *
 * Called `betterPeer`, not "recommendation": it is the answer to "does anything
 * in this category actually rank meaningfully higher?", which is arithmetic. Funds
 * the user already holds are excluded — surfacing a fund they own as the
 * alternative to another fund they own is not an alternative.
 */
const findBetterPeer = (
  fund: MutualFund,
  standing: number,
  groups: PeerGroups,
  context: ScoringContext,
  alreadyHeld: Set<string>,
): BetterPeer | null => {
  const peers = groups.ranked(fund);

  const better = peers.filter((candidate) => {
    if (candidate.id === fund.id || alreadyHeld.has(candidate.id)) return false;
    const candidateStanding = scoreFund(candidate, context).measuredScore;
    return candidateStanding - standing >= MATERIAL_STANDING_GAP;
  });

  if (better.length === 0) return null;

  const top = better[0];
  const topStanding = scoreFund(top, context).measuredScore;
  const shared = sharedReturn(fund, top);
  const mineTer = toNumber(fund.expenseRatio);
  const theirsTer = toNumber(top.expenseRatio);

  return {
    fund: top,
    standing: topStanding,
    standingGap: topStanding - standing,
    annualAdvantage: shared?.advantage ?? null,
    advantageBasis: shared?.basis ?? null,
    expenseRatioDelta: mineTer != null && theirsTer != null ? theirsTer - mineTer : null,
    betterCount: better.length,
  };
};

/**
 * Years for the alternative's return advantage to recover the one-off switch cost.
 *
 * Deliberately simple division — cost as a percentage of the position, over the
 * annual advantage in points. It ignores compounding, which flatters longer
 * break-evens slightly, and that is the right direction for a number used to
 * decide whether *not* to sell.
 *
 * It also assumes the trailing return gap persists, which is an assumption and
 * not a forecast. That is why the verdict text always names the gap and the
 * horizon it came from: a 15-point gap over one year is a very different claim
 * from a 2-point gap over five, and the user can see which they are being shown.
 */
const breakEvenYearsFor = (
  switchCost: SwitchCost | null,
  betterPeer: BetterPeer | null,
): number | null => {
  if (switchCost?.percentOfValue == null) return null;
  if (switchCost.percentOfValue <= 0) return 0;
  if (betterPeer?.annualAdvantage == null || betterPeer.annualAdvantage <= 0) return null;

  return switchCost.percentOfValue / betterPeer.annualAdvantage;
};

/**
 * Passive schemes, which must not be judged on peer standing
 * ----------------------------------------------------------
 *
 * An index fund is a deliberate decision to take the index return and stop
 * choosing. Scored against active peers it will sit mid-to-low by construction
 * in any period when active managers beat the index, because alpha, Sharpe and
 * information ratio are all measured against exactly the benchmark it is trying
 * to replicate. Reporting "bottom 35% of Large Cap, 41 funds rank higher, worth
 * switching" is not a finding — it is the metric misapplied, and it would push a
 * user out of a defensible strategy on the strength of an arithmetic artefact.
 *
 * So peer standing is still *shown* for a passive holding, and never used to
 * justify leaving it. What does apply is cost: two funds tracking one index differ
 * only in expense ratio and tracking difference, and the expense ratio is
 * published. That comparison replaces the peer-standing one.
 *
 * Detection is by name and sub-category, since the feed carries no passive flag.
 * `fund of fund` is included because index FoFs are passive too; deliberately
 * absent is anything about "smart beta" or "factor", which are active choices
 * dressed as rules.
 */
const PASSIVE_NAME_FORMS =
  /\b(index|etf|nifty|sensex|bse\s*\d|nasdaq|s&p)\b/i;

export const isPassive = (fund: MutualFund): boolean =>
  PASSIVE_NAME_FORMS.test(fund.schemeName ?? '') ||
  PASSIVE_NAME_FORMS.test(fund.subCategory ?? '') ||
  /index|etf/i.test(fund.subCategory ?? '');

/**
 * The cheapest scheme tracking the same benchmark, when it is materially cheaper.
 *
 * The right question for a passive holding: same index, lower fee. Only funds
 * reporting the identical `benchmarkName` are compared, because that is the only
 * evidence in the dataset that two schemes are tracking the same thing.
 */
export interface CheaperTracker {
  fund: MutualFund;
  expenseRatio: number;
  /** Points of expense ratio saved a year. */
  saving: number;
  /** What that is worth annually on this position, in rupees. */
  annualSavingRupees: number | null;
}

/** Expense ratio gap worth mentioning, in percentage points. */
const MATERIAL_TER_GAP = 0.1;

const findCheaperTracker = (
  fund: MutualFund,
  universe: MutualFund[],
  currentValue: number | null,
): CheaperTracker | null => {
  const benchmark = fund.benchmarkName?.trim();
  const ownTer = toNumber(fund.expenseRatio);
  if (!benchmark || ownTer == null) return null;

  let best: { fund: MutualFund; ter: number } | null = null;

  for (const candidate of universe) {
    if (candidate.id === fund.id) continue;
    if (candidate.benchmarkName?.trim() !== benchmark) continue;
    if (!isPassive(candidate)) continue;

    const ter = toNumber(candidate.expenseRatio);
    if (ter == null) continue;
    if (best == null || ter < best.ter) best = { fund: candidate, ter };
  }

  if (best == null || ownTer - best.ter < MATERIAL_TER_GAP) return null;

  const saving = ownTer - best.ter;
  return {
    fund: best.fund,
    expenseRatio: best.ter,
    saving: round(saving, 3),
    annualSavingRupees: currentValue != null ? round(currentValue * (saving / 100)) : null,
  };
};

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const formatRupees = (value: number): string =>
  `₹${Math.round(value).toLocaleString('en-IN')}`;

const schemeNameOf = (fund: MutualFund): string => fund.schemeName ?? fund.fundName ?? 'that scheme';

/** For a clause reused both mid-sentence and at the start of one. */
const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const formatMonths = (months: number): string =>
  months >= 12
    ? `${Math.floor(months / 12)}y ${months % 12}m`
    : `${months} month${months === 1 ? '' : 's'}`;

/* ---------------------------------------------------------------------------
 * Per-holding signals and verdict
 * ------------------------------------------------------------------------- */

interface SignalContext {
  duplicateFolios: number;
  valuedCount: number;
  /** True when a SIP in the snapshot is still feeding this same fund. */
  hasActiveSip: boolean;
}

const holdingSignals = (
  evaluated: Omit<EvaluatedHolding, 'signals' | 'verdict' | 'verdictReason'>,
  { duplicateFolios, valuedCount, hasActiveSip }: SignalContext,
): Signal[] => {
  const signals: Signal[] = [];
  const { fund, breakdown, standing } = evaluated;

  if (!fund || !breakdown || standing == null) {
    return [
      {
        kind: 'thin-data',
        tone: 'neutral',
        message: 'Not matched to a scheme in the dataset, so nothing here could be measured.',
      },
    ];
  }

  if (evaluated.isPassive) {
    signals.push({
      kind: 'peer-standing',
      tone: 'neutral',
      message:
        'Passive fund. Its peer standing is shown for context but is not used to judge it — alpha and Sharpe are measured against the very index it is built to replicate, so it will trail active peers whenever they beat the index.',
    });

    if (evaluated.cheaperTracker) {
      signals.push({
        kind: 'cost',
        tone: 'warn',
        message: `${schemeNameOf(evaluated.cheaperTracker.fund)} tracks the same benchmark for ${evaluated.cheaperTracker.saving.toFixed(2)} points less a year${evaluated.cheaperTracker.annualSavingRupees != null ? ` — about ${formatRupees(evaluated.cheaperTracker.annualSavingRupees)} on this position` : ''}.`,
      });
    }
  }

  if (!breakdown.hasSufficientData) {
    const track = breakdown.trackRecord;
    signals.push({
      kind: 'thin-data',
      tone: 'neutral',
      message: track.isNew
        ? `Only ${track.years.toFixed(1)} years of history — too little to judge against peers.`
        : `Only ${Math.round(breakdown.coverage * 100)}% of the scored metrics are available for this fund, so its standing is not reliable.`,
    });
  } else if (evaluated.isPassive) {
    // Standing is reported above as context; no top/bottom framing for a tracker.
  } else if (standing >= 75) {
    signals.push({
      kind: 'peer-standing',
      tone: 'good',
      message: `Top ${Math.max(1, Math.round(100 - standing))}% of ${breakdown.peerGroup} on the scored metrics.`,
    });
  } else if (standing < WEAK_STANDING) {
    signals.push({
      kind: 'peer-standing',
      tone: 'bad',
      message: `Bottom ${Math.round(standing)}% of ${breakdown.peerGroup} on the scored metrics (${breakdown.peerCount} funds).`,
    });
  }

  if (evaluated.categoryExcess != null) {
    if (evaluated.categoryExcess <= -CATEGORY_LAG_POINTS) {
      signals.push({
        kind: 'category-lag',
        tone: 'warn',
        message: `Trails its own category average by ${Math.abs(evaluated.categoryExcess).toFixed(1)} points a year, averaged over the horizons available.`,
      });
    } else if (evaluated.categoryExcess >= CATEGORY_LAG_POINTS) {
      signals.push({
        kind: 'category-lag',
        tone: 'good',
        message: `Beats its own category average by ${evaluated.categoryExcess.toFixed(1)} points a year.`,
      });
    }
  }

  const ter = toNumber(fund.expenseRatio);
  const terPercentile = breakdown.percentiles.expenseRatio;
  if (ter != null && terPercentile != null && terPercentile < 25) {
    const annual = evaluated.currentValue != null ? evaluated.currentValue * (ter / 100) : null;
    signals.push({
      kind: 'cost',
      tone: 'warn',
      message: `Expense ratio of ${ter.toFixed(2)}% is among the priciest in ${breakdown.peerGroup}${annual != null ? `, costing about ${formatRupees(annual)} a year on this position` : ''}.`,
    });
  }

  if (evaluated.worstOverlap && evaluated.worstOverlap.percent >= NOTABLE_OVERLAP_PERCENT) {
    const { percent, schemeName, otherRanksHigher } = evaluated.worstOverlap;
    signals.push({
      kind: 'overlap',
      tone: percent >= DUPLICATE_OVERLAP_PERCENT ? 'bad' : 'warn',
      message: `${percent.toFixed(0)}% of holdings shared with ${schemeName}${otherRanksHigher ? ', which ranks higher of the two' : ', which ranks lower of the two'}.`,
    });
  }

  if (
    concentrationIsMeaningful(valuedCount) &&
    evaluated.weightPercent > OVERWEIGHT_FUND_PERCENT
  ) {
    signals.push({
      kind: 'concentration',
      tone: 'warn',
      message: `${evaluated.weightPercent.toFixed(0)}% of the portfolio sits in this one fund.`,
    });
  }

  if (duplicateFolios > 1) {
    signals.push({
      kind: 'duplicate-row',
      tone: 'neutral',
      message: `Held across ${duplicateFolios} rows. They are kept separate because each has its own purchase date, and so its own capital gains clock.`,
    });
  }

  const lockIn = toNumber(fund.lockInMonths) ?? 0;
  if (lockIn > 0) {
    signals.push({
      kind: 'lock-in',
      tone: 'neutral',
      message: `${Math.round(lockIn)}-month lock-in, so units cannot be redeemed on demand regardless of the verdict.`,
    });
  }

  const cost = evaluated.switchCost;
  if (cost) {
    if (cost.exitLoad.ratePercent > 0) {
      signals.push({
        kind: 'exit-window',
        tone: 'warn',
        message: `Exit load of ${cost.exitLoad.ratePercent}% still applies — ${formatRupees(cost.exitLoadAmount)} on this position, lapsing in ${cost.exitLoad.daysUntilFree} days.`,
      });
    }
    if (cost.monthsToLongTerm > 0 && cost.savingByWaiting != null && cost.savingByWaiting > 0) {
      signals.push({
        kind: 'tax-timing',
        tone: 'warn',
        message: `${formatMonths(cost.monthsToLongTerm)} short of long-term treatment. Waiting would save about ${formatRupees(cost.savingByWaiting)} of tax on today's gain.`,
      });
    }
    if (evaluated.gain != null && evaluated.gain < 0) {
      signals.push({
        kind: 'loss',
        tone: 'neutral',
        message: 'Position is at a loss, so exiting would not trigger capital gains tax.',
      });
    }
  }

  if (evaluated.holding.looksRegularPlan) {
    signals.push({
      kind: 'plan',
      tone: 'warn',
      message:
        'Your statement names a regular plan. Metrics here are for the direct plan of the same scheme, so the real expense ratio you pay is higher than shown.',
    });
  }

  /*
   * A position still being fed by a SIP is not one lot, it is one lot per
   * instalment — each with its own exit load window and its own capital gains
   * clock. The file gives a single purchase date, so the cost of leaving is
   * computed as though the whole position were bought then, which *understates*
   * it: the newest instalments may still be inside the load window and are
   * certainly short-term. Worth saying rather than quietly being wrong.
   */
  if (hasActiveSip && evaluated.switchCost != null) {
    signals.push({
      kind: 'tax-timing',
      tone: 'warn',
      message:
        'A SIP is still adding to this fund, so the position is many lots with different dates. The switch cost above treats it as one lot bought on the stated date, which understates it — the most recent instalments are short-term and may still be inside the exit load window.',
    });
  }

  return signals;
};

const holdingVerdict = (
  evaluated: Omit<EvaluatedHolding, 'signals' | 'verdict' | 'verdictReason'>,
  valuedCount: number,
): { verdict: HoldingVerdict; reason: string } => {
  const { fund, breakdown, standing, betterPeer, switchCost, breakEvenYears, worstOverlap } =
    evaluated;

  if (!fund || !breakdown || standing == null) {
    return {
      verdict: 'unjudged',
      reason: 'Could not be matched to a scheme in the dataset, so there is nothing to judge it on.',
    };
  }

  if (!breakdown.hasSufficientData) {
    return {
      verdict: 'unjudged',
      reason: breakdown.trackRecord.isNew
        ? `Only ${breakdown.trackRecord.years.toFixed(1)} years of history. Too little to rank against peers either way.`
        : `Only ${Math.round(breakdown.coverage * 100)}% of the scored metrics are published for this fund, which is not enough to place it against its peers.`,
    };
  }

  const lags =
    evaluated.categoryExcess != null && evaluated.categoryExcess <= -CATEGORY_LAG_POINTS;
  const duplicateOfBetter =
    worstOverlap != null &&
    worstOverlap.percent >= DUPLICATE_OVERLAP_PERCENT &&
    worstOverlap.otherRanksHigher;

  /*
   * A passive fund is never "weak" on peer standing — see isPassive. Duplication
   * still counts, because two funds tracking the same index really are one bet.
   */
  if (evaluated.isPassive) {
    const cheaper = evaluated.cheaperTracker;
    if (!duplicateOfBetter) {
      return {
        verdict: 'keep',
        reason: cheaper
          ? `An index fund, so where it ranks against active ${breakdown.peerGroup} funds is not the test — it is meant to track, not beat. Cost is the test, and ${schemeNameOf(cheaper.fund)} tracks the same benchmark at ${cheaper.expenseRatio.toFixed(2)}% against this fund's ${(toNumber(fund.expenseRatio) ?? 0).toFixed(2)}%${cheaper.annualSavingRupees != null ? `, about ${formatRupees(cheaper.annualSavingRupees)} a year on this position` : ''}.`
          : `An index fund, so where it ranks against active ${breakdown.peerGroup} funds is not the test — it is meant to track, not beat. No cheaper scheme tracking the same benchmark was found in the dataset.`,
      };
    }
  }

  const weak = !evaluated.isPassive && standing < WEAK_STANDING;

  const cheapToLeave =
    switchCost?.percentOfValue != null &&
    switchCost.percentOfValue <= NEGLIGIBLE_SWITCH_COST_PERCENT;
  const quickBreakEven = breakEvenYears != null && breakEvenYears <= QUICK_BREAK_EVEN_YEARS;

  /*
   * The two cases where moving money is arguably worth its cost: the fund is a
   * genuine laggard with a materially better peer available, or it is a
   * near-duplicate of something the user holds that ranks higher. Both then have
   * to clear the cost test — which is the whole point of this module.
   */
  if ((weak && betterPeer) || duplicateOfBetter) {
    const because = duplicateOfBetter
      ? `${worstOverlap.percent.toFixed(0)}% of its holdings duplicate ${worstOverlap.schemeName}, which ranks higher`
      : `it sits in the bottom ${Math.round(standing)}% of ${breakdown.peerGroup} and ${betterPeer!.betterCount} fund${betterPeer!.betterCount === 1 ? '' : 's'} there rank at least ${MATERIAL_STANDING_GAP} points higher`;

    if (cheapToLeave) {
      return {
        verdict: 'exit',
        reason: `Switching is close to free — ${switchCost?.totalAmount != null ? formatRupees(switchCost.totalAmount) : 'no'} in load and tax, ${switchCost?.percentOfValue?.toFixed(1) ?? '0'}% of the position — and ${because}.`,
      };
    }

    if (quickBreakEven) {
      return {
        verdict: 'exit',
        reason: `${capitalise(because)}. Switching costs ${formatRupees(switchCost!.totalAmount!)} (${switchCost!.percentOfValue!.toFixed(1)}% of the position), which the ${betterPeer!.annualAdvantage!.toFixed(1)}-point ${betterPeer!.advantageBasis} return gap recovers in about ${breakEvenYears!.toFixed(1)} years — assuming that gap holds, which is an assumption.`,
      };
    }

    if (switchCost == null) {
      return {
        verdict: 'watch',
        reason: `${capitalise(because)}. What a switch would cost could not be worked out — that needs a purchase date and a cost figure — so this stops short of a switch call.`,
      };
    }

    if (switchCost.totalAmount == null) {
      return {
        verdict: 'watch',
        reason: `${capitalise(because)}. This fund's gains are taxed at your slab rate, so set a marginal rate to see whether switching is worth it.`,
      };
    }

    const waiting =
      switchCost.monthsToLongTerm > 0
        ? ` Holding ${formatMonths(switchCost.monthsToLongTerm)} more moves it into the long-term bucket and saves about ${formatRupees(switchCost.savingByWaiting ?? 0)} of that.`
        : '';

    return {
      verdict: 'watch',
      reason: `${capitalise(because)}, but switching costs ${formatRupees(switchCost.totalAmount)} — ${switchCost.percentOfValue!.toFixed(1)}% of the position${breakEvenYears != null ? `, about ${breakEvenYears.toFixed(1)} years of the return gap` : ''}.${waiting}`,
    };
  }

  if (
    concentrationIsMeaningful(valuedCount) &&
    evaluated.weightPercent > OVERWEIGHT_FUND_PERCENT
  ) {
    return {
      verdict: 'trim',
      reason: `Nothing wrong with the fund — it stands at ${Math.round(standing)} of 100 in ${breakdown.peerGroup} — but ${evaluated.weightPercent.toFixed(0)}% of the portfolio in one scheme is a concentration decision rather than a fund one.`,
    };
  }

  if (weak) {
    return {
      verdict: 'watch',
      // Deliberately says "that you do not already hold": findBetterPeer excludes
      // the user's own funds, so the honest claim is about available alternatives,
      // not about the whole sub-category.
      reason: `Bottom ${Math.round(standing)}% of ${breakdown.peerGroup}, but nothing in the sub-category that you do not already hold ranks ${MATERIAL_STANDING_GAP}+ points higher — switching would trade one mid-pack fund for another.`,
    };
  }

  if (lags) {
    return {
      verdict: 'watch',
      reason: `Stands at ${Math.round(standing)} of 100 against peers, but trails its own category average by ${Math.abs(evaluated.categoryExcess!).toFixed(1)} points a year. Worth watching rather than acting on.`,
    };
  }

  if (standing >= STRONG_STANDING) {
    return {
      verdict: 'buy',
      reason: `Top ${Math.max(1, Math.round(100 - standing))}% of ${breakdown.peerGroup} across ${Math.round(breakdown.coverage * 100)}% of the scored metrics.`,
    };
  }

  return {
    verdict: 'keep',
    reason: `Mid-pack in ${breakdown.peerGroup} at ${Math.round(standing)} of 100, with nothing flagged against it. Mid-pack is not a reason to pay tax and exit load to move.`,
  };
};

/* ---------------------------------------------------------------------------
 * Per-SIP signals and verdict
 * ------------------------------------------------------------------------- */

const sipSignals = (
  evaluated: Omit<EvaluatedSip, 'signals' | 'verdict' | 'verdictReason'>,
): Signal[] => {
  const signals: Signal[] = [];
  const { fund, breakdown, standing } = evaluated;

  if (!fund || !breakdown || standing == null) {
    return [
      {
        kind: 'thin-data',
        tone: 'neutral',
        message: 'Not matched to a scheme in the dataset, so nothing here could be measured.',
      },
    ];
  }

  if (evaluated.isPassive) {
    signals.push({
      kind: 'peer-standing',
      tone: 'neutral',
      message:
        'Passive fund, so its rank against active peers is context rather than a judgement. Cost is what distinguishes two funds tracking one index.',
    });
    if (evaluated.cheaperTracker) {
      signals.push({
        kind: 'cost',
        tone: 'warn',
        message: `${schemeNameOf(evaluated.cheaperTracker.fund)} tracks the same benchmark for ${evaluated.cheaperTracker.saving.toFixed(2)} points less a year.`,
      });
    }
  }

  if (!breakdown.hasSufficientData) {
    signals.push({
      kind: 'thin-data',
      tone: 'neutral',
      message: breakdown.trackRecord.isNew
        ? `Only ${breakdown.trackRecord.years.toFixed(1)} years of history to judge this fund on.`
        : `Only ${Math.round(breakdown.coverage * 100)}% of the scored metrics are available for this fund.`,
    });
  } else if (evaluated.isPassive) {
    // Reported above as context; no top/bottom framing for a tracker.
  } else if (standing >= 75) {
    signals.push({
      kind: 'peer-standing',
      tone: 'good',
      message: `Top ${Math.max(1, Math.round(100 - standing))}% of ${breakdown.peerGroup}.`,
    });
  } else if (standing < WEAK_STANDING) {
    signals.push({
      kind: 'peer-standing',
      tone: 'bad',
      message: `Bottom ${Math.round(standing)}% of ${breakdown.peerGroup}.`,
    });
  }

  if (evaluated.categoryExcess != null && evaluated.categoryExcess <= -CATEGORY_LAG_POINTS) {
    signals.push({
      kind: 'category-lag',
      tone: 'warn',
      message: `Trails its own category average by ${Math.abs(evaluated.categoryExcess).toFixed(1)} points a year.`,
    });
  }

  if (evaluated.worstOverlap && evaluated.worstOverlap.percent >= NOTABLE_OVERLAP_PERCENT) {
    signals.push({
      kind: 'overlap',
      tone: evaluated.worstOverlap.percent >= DUPLICATE_OVERLAP_PERCENT ? 'bad' : 'warn',
      message: `${evaluated.worstOverlap.percent.toFixed(0)}% of holdings shared with ${evaluated.worstOverlap.schemeName} — new money into both largely buys the same stocks.`,
    });
  }

  const lockIn = toNumber(fund.lockInMonths) ?? 0;
  if (lockIn > 0) {
    signals.push({
      kind: 'lock-in',
      tone: 'warn',
      message: `${Math.round(lockIn)}-month lock-in, and under a SIP each instalment locks from its own date — so a rolling portion stays locked for as long as the SIP runs.`,
    });
  }

  if (fund.sipAllowed === false) {
    signals.push({
      kind: 'thin-data',
      tone: 'warn',
      message: 'The dataset reports this scheme as not accepting SIPs, which contradicts your file. Worth checking which is right.',
    });
  }

  if (!evaluated.sip.active) {
    signals.push({
      kind: 'thin-data',
      tone: 'neutral',
      message: 'Marked inactive in your file, so it is left out of the commitment totals.',
    });
  }

  if (evaluated.sip.looksRegularPlan) {
    signals.push({
      kind: 'plan',
      tone: 'warn',
      message:
        'Your file names a regular plan. The direct plan of the same scheme is what is measured here, and it is cheaper — switching future instalments to direct costs nothing but paperwork.',
    });
  }

  return signals;
};

/**
 * SIP verdicts, on a deliberately lower bar than holdings.
 *
 * Redirecting future instalments has no exit load, no tax and no realised gain,
 * so there is nothing to weigh against a fund that ranks poorly. That is why
 * there is no cost test here and why a fund can honestly be "keep what you hold,
 * stop adding to it".
 *
 * There is deliberately no "stop" verdict. Stopping a SIP without redirecting it
 * changes how much the user invests and their asset mix, which is a decision about
 * their plan rather than about this fund — and this module knows nothing about
 * their plan.
 */
const sipVerdict = (
  evaluated: Omit<EvaluatedSip, 'signals' | 'verdict' | 'verdictReason'>,
): { verdict: SipVerdict; reason: string } => {
  const { fund, breakdown, standing, betterPeer, worstOverlap } = evaluated;

  if (!fund || !breakdown || standing == null) {
    return {
      verdict: 'unjudged',
      reason: 'Could not be matched to a scheme in the dataset.',
    };
  }

  if (!breakdown.hasSufficientData) {
    return {
      verdict: 'review',
      reason: breakdown.trackRecord.isNew
        ? `Only ${breakdown.trackRecord.years.toFixed(1)} years of history, so this SIP is going into a fund with no judgeable record yet.`
        : `Only ${Math.round(breakdown.coverage * 100)}% of the scored metrics are published for this fund, so where it stands against peers is unclear.`,
    };
  }

  const duplicate =
    worstOverlap != null &&
    worstOverlap.percent >= DUPLICATE_OVERLAP_PERCENT &&
    worstOverlap.otherRanksHigher;

  if (duplicate) {
    return {
      verdict: 'redirect',
      reason: `${worstOverlap.percent.toFixed(0)}% of this fund's holdings duplicate ${worstOverlap.schemeName}, which ranks higher. Pointing future instalments at one of the two costs nothing and buys the same exposure with less admin.`,
    };
  }

  // Same reasoning as for holdings: an index fund is not failing when active
  // peers beat the index, so peer standing cannot justify redirecting it.
  if (evaluated.isPassive) {
    const cheaper = evaluated.cheaperTracker;
    return {
      verdict: cheaper ? 'review' : 'continue',
      reason: cheaper
        ? `An index fund, so its rank against active ${breakdown.peerGroup} funds is not the test. Cost is, and ${schemeNameOf(cheaper.fund)} tracks the same benchmark at ${cheaper.expenseRatio.toFixed(2)}% against ${(toNumber(fund.expenseRatio) ?? 0).toFixed(2)}% — worth checking before the next instalment, since redirecting costs nothing.`
        : `An index fund tracking its benchmark, and no cheaper scheme on the same benchmark was found. Its rank against active ${breakdown.peerGroup} funds is not the relevant test.`,
    };
  }

  if (standing < WEAK_STANDING && betterPeer) {
    return {
      verdict: 'redirect',
      reason: `Bottom ${Math.round(standing)}% of ${breakdown.peerGroup}, with ${betterPeer.betterCount} fund${betterPeer.betterCount === 1 ? '' : 's'} there ranking at least ${MATERIAL_STANDING_GAP} points higher. Future instalments can move at no cost — no exit load, no tax, nothing realised.`,
    };
  }

  if (standing < WEAK_STANDING) {
    return {
      verdict: 'review',
      reason: `Bottom ${Math.round(standing)}% of ${breakdown.peerGroup}, but nothing in the sub-category ranks materially higher, so there is nowhere obviously better to point the money.`,
    };
  }

  if (evaluated.categoryExcess != null && evaluated.categoryExcess <= -CATEGORY_LAG_POINTS) {
    return {
      verdict: 'review',
      reason: `Stands at ${Math.round(standing)} of 100 against peers but trails its own category average by ${Math.abs(evaluated.categoryExcess).toFixed(1)} points a year.`,
    };
  }

  return {
    verdict: 'continue',
    reason:
      standing >= STRONG_STANDING
        ? `Top ${Math.max(1, Math.round(100 - standing))}% of ${breakdown.peerGroup}, with nothing flagged against it.`
        : `Mid-pack in ${breakdown.peerGroup} at ${Math.round(standing)} of 100, with nothing flagged against it.`,
  };
};

/* ---------------------------------------------------------------------------
 * Look-through
 * ------------------------------------------------------------------------- */

/** Asset classes whose disclosed holdings are stocks, and so comparable. */
const LOOK_THROUGH_CLASSES: AssetClass[] = ['equity', 'hybrid', 'international'];

const buildLookThrough = (
  holdings: EvaluatedHolding[],
  index: HoldingsIndex,
): LookThrough | null => {
  const relevant = holdings.filter(
    (h) =>
      h.fund != null &&
      h.currentValue != null &&
      h.currentValue > 0 &&
      h.assetClass != null &&
      LOOK_THROUGH_CLASSES.includes(h.assetClass),
  );

  const totalMoney = relevant.reduce((sum, h) => sum + (h.currentValue ?? 0), 0);
  if (totalMoney <= 0) return null;

  const weights = new Map<string, { name: string; amount: number }>();
  let covered = 0;

  for (const holding of relevant) {
    const entry = index.get(holding.fund!.schemeCode);
    if (!entry || entry.holdings.length === 0) continue;

    covered += holding.currentValue!;

    for (const stock of entry.holdings) {
      const percent = toNumber(stock.percent);
      if (percent == null || percent <= 0) continue;

      const key = stock.id?.trim().toLowerCase() || stock.name.toLowerCase();
      const amount = holding.currentValue! * (percent / 100);
      const existing = weights.get(key);
      if (existing) existing.amount += amount;
      else weights.set(key, { name: stock.name, amount });
    }
  }

  if (covered <= 0) return null;

  const ranked = [...weights.values()]
    .map((entry) => ({ name: entry.name, percent: round((entry.amount / covered) * 100, 1) }))
    .sort((a, b) => b.percent - a.percent);

  return {
    coveragePercent: round((covered / totalMoney) * 100, 1),
    uniqueIssuers: ranked.length,
    top: ranked.slice(0, 12),
    topTenPercent: round(
      ranked.slice(0, 10).reduce((sum, entry) => sum + entry.percent, 0),
      1,
    ),
  };
};

/* ---------------------------------------------------------------------------
 * The evaluation
 * ------------------------------------------------------------------------- */

export interface EvaluationInput {
  mf: MfHolding[];
  sips: SipHolding[];
  /** Full universe, for peer groups and alternatives. */
  universe: MutualFund[];
  /** Peer distributions built from the unfiltered universe. */
  context: ScoringContext;
  /** Stock-level holdings per fund, for overlap and look-through. */
  fundHoldings?: HoldingsIndex;
  /** Target split to measure drift against. Omit to report actuals only. */
  targetAllocation?: AssetAllocation;
  /** Marginal slab rate, needed for slab-taxed buckets. */
  slabRatePercent?: number;
  /** Remaining per-PAN long-term exemption for the year. */
  exemptionHeadroomRupees?: number;
  now?: Date;
}

export const evaluatePortfolio = (input: EvaluationInput): PortfolioEvaluation => {
  const now = input.now ?? new Date();
  const byId = new Map(input.universe.map((fund) => [fund.id, fund]));
  const groups = new PeerGroups(input.universe, input.context);
  const notes: string[] = [];

  const heldIds = new Set(
    [...input.mf, ...input.sips]
      .map((row) => row.fundId)
      .filter((id): id is string => id != null),
  );

  /* --- Holdings, first pass: figures and fund resolution ---------------- */

  const folioCounts = new Map<string, number>();
  for (const holding of input.mf) {
    if (holding.fundId) folioCounts.set(holding.fundId, (folioCounts.get(holding.fundId) ?? 0) + 1);
  }

  type Draft = Omit<EvaluatedHolding, 'signals' | 'verdict' | 'verdictReason'>;

  const drafts: Draft[] = input.mf.map((holding) => {
    const fund = holding.fundId ? byId.get(holding.fundId) ?? null : null;
    const breakdown = fund ? scoreFund(fund, input.context) : null;
    const standing = breakdown ? breakdown.measuredScore : null;

    const invested = holding.investedAmount;
    const currentValue = holding.currentValue;
    const gain = invested != null && currentValue != null ? currentValue - invested : null;

    const holdingMonths = holdingMonthsSince(holding.purchaseDate, now);
    const holdingDays = holdingDaysSince(holding.purchaseDate, now);

    return {
      holding,
      fund,
      breakdown,
      standing,
      rank: 0,
      invested,
      currentValue,
      gain,
      gainPercent: gain != null && invested != null && invested > 0 ? (gain / invested) * 100 : null,
      weightPercent: 0,
      holdingMonths,
      assetClass: fund ? classifyAssetClass(fund) : null,
      categoryExcess: fund ? categoryExcessOf(fund) : null,
      switchCost:
        fund != null
          ? switchCostOf(fund, {
              invested,
              currentValue,
              holdingMonths,
              holdingDays,
              slabRatePercent: input.slabRatePercent,
              exemptionHeadroomRupees: input.exemptionHeadroomRupees,
            })
          : null,
      // No "better peer" for a tracker: the comparison is cost against the same
      // benchmark, which is `cheaperTracker`, not rank against active funds.
      betterPeer:
        fund != null && standing != null && breakdown?.hasSufficientData && !isPassive(fund)
          ? findBetterPeer(fund, standing, groups, input.context, heldIds)
          : null,
      breakEvenYears: null,
      worstOverlap: null,
      isPassive: fund != null && isPassive(fund),
      cheaperTracker:
        fund != null && isPassive(fund)
          ? findCheaperTracker(fund, input.universe, currentValue)
          : null,
    };
  });

  const totalValue = drafts.reduce((sum, draft) => sum + (draft.currentValue ?? 0), 0);
  for (const draft of drafts) {
    draft.weightPercent =
      totalValue > 0 && draft.currentValue != null ? (draft.currentValue / totalValue) * 100 : 0;
    draft.breakEvenYears = breakEvenYearsFor(draft.switchCost, draft.betterPeer);
  }

  /* --- Ranking, on untilted peer standing ------------------------------- */

  const ranked = [...drafts]
    .filter((draft) => draft.standing != null)
    .sort((a, b) => (b.standing ?? 0) - (a.standing ?? 0));
  ranked.forEach((draft, index) => {
    draft.rank = index + 1;
  });

  /* --- Overlap between the user's own funds ----------------------------- */

  const overlapPairs: OverlapPairRow[] = [];
  const fundHoldings = input.fundHoldings;

  if (fundHoldings) {
    for (let i = 0; i < drafts.length; i++) {
      for (let j = i + 1; j < drafts.length; j++) {
        const a = drafts[i];
        const b = drafts[j];
        if (!a.fund || !b.fund || a.fund.id === b.fund.id) continue;

        const percent = overlapPercent(a.fund, b.fund, fundHoldings);
        if (percent == null) continue;

        const aBetter = (a.standing ?? 0) >= (b.standing ?? 0);

        if (a.worstOverlap == null || percent > a.worstOverlap.percent) {
          a.worstOverlap = {
            holdingId: b.holding.id,
            schemeName: b.fund.schemeName,
            percent,
            otherRanksHigher: !aBetter,
          };
        }
        if (b.worstOverlap == null || percent > b.worstOverlap.percent) {
          b.worstOverlap = {
            holdingId: a.holding.id,
            schemeName: a.fund.schemeName,
            percent,
            otherRanksHigher: aBetter,
          };
        }

        if (percent >= NOTABLE_OVERLAP_PERCENT) {
          const combined =
            a.currentValue != null && b.currentValue != null
              ? a.currentValue + b.currentValue
              : null;
          overlapPairs.push({
            aId: a.holding.id,
            bId: b.holding.id,
            aName: a.fund.schemeName,
            bName: b.fund.schemeName,
            percent,
            combinedAmount: combined,
          });
        }
      }
    }
    overlapPairs.sort((x, y) => y.percent - x.percent);
  }

  /* --- Holdings, second pass: signals and verdicts ---------------------- */

  const valuedCount = drafts.filter(
    (draft) => draft.fund != null && draft.currentValue != null && draft.currentValue > 0,
  ).length;

  const fundsWithActiveSip = new Set(
    input.sips.filter((row) => row.active && row.fundId != null).map((row) => row.fundId!),
  );

  const holdings: EvaluatedHolding[] = drafts.map((draft) => {
    const { verdict, reason } = holdingVerdict(draft, valuedCount);
    return {
      ...draft,
      signals: holdingSignals(draft, {
        duplicateFolios: draft.fund ? folioCounts.get(draft.fund.id) ?? 1 : 1,
        valuedCount,
        hasActiveSip: draft.fund != null && fundsWithActiveSip.has(draft.fund.id),
      }),
      verdict,
      verdictReason: reason,
    };
  });

  /* --- SIPs ------------------------------------------------------------- */

  type SipDraft = Omit<EvaluatedSip, 'signals' | 'verdict' | 'verdictReason'>;

  const sipDrafts: SipDraft[] = input.sips.map((sip) => {
    const fund = sip.fundId ? byId.get(sip.fundId) ?? null : null;
    const breakdown = fund ? scoreFund(fund, input.context) : null;
    const standing = breakdown ? breakdown.measuredScore : null;
    const perYear = INSTALMENTS_PER_YEAR[sip.frequency];

    return {
      sip,
      fund,
      breakdown,
      standing,
      rank: 0,
      monthlyEquivalent:
        sip.amount != null && perYear != null ? round((sip.amount * perYear) / 12) : null,
      weightPercent: 0,
      assetClass: fund ? classifyAssetClass(fund) : null,
      categoryExcess: fund ? categoryExcessOf(fund) : null,
      // No "better peer" for a tracker: the comparison is cost against the same
      // benchmark, which is `cheaperTracker`, not rank against active funds.
      betterPeer:
        fund != null && standing != null && breakdown?.hasSufficientData && !isPassive(fund)
          ? findBetterPeer(fund, standing, groups, input.context, heldIds)
          : null,
      worstOverlap: null,
      isPassive: fund != null && isPassive(fund),
      cheaperTracker:
        fund != null && isPassive(fund) ? findCheaperTracker(fund, input.universe, null) : null,
    };
  });

  const activeSips = sipDrafts.filter((draft) => draft.sip.active);
  const monthlyTotal = activeSips.reduce((sum, draft) => sum + (draft.monthlyEquivalent ?? 0), 0);

  for (const draft of activeSips) {
    draft.weightPercent =
      monthlyTotal > 0 && draft.monthlyEquivalent != null
        ? (draft.monthlyEquivalent / monthlyTotal) * 100
        : 0;
  }

  const rankedSips = [...sipDrafts]
    .filter((draft) => draft.standing != null)
    .sort((a, b) => (b.standing ?? 0) - (a.standing ?? 0));
  rankedSips.forEach((draft, index) => {
    draft.rank = index + 1;
  });

  /*
   * A SIP is compared against every other SIP *and* against existing holdings.
   * Both matter and for different reasons: two overlapping SIPs are buying the
   * same stocks twice a month, while a SIP overlapping a large existing holding
   * is quietly concentrating a position the user may think is diversifying.
   */
  if (fundHoldings) {
    for (const draft of sipDrafts) {
      if (!draft.fund) continue;

      const others: Array<{ fund: MutualFund; id: string; standing: number | null }> = [
        ...sipDrafts
          .filter((other) => other !== draft && other.fund != null)
          .map((other) => ({ fund: other.fund!, id: other.sip.id, standing: other.standing })),
        ...drafts
          .filter((other) => other.fund != null)
          .map((other) => ({ fund: other.fund!, id: other.holding.id, standing: other.standing })),
      ];

      for (const other of others) {
        if (other.fund.id === draft.fund.id) {
          // The same fund via two routes is a 100% overlap by definition, and
          // worth saying so rather than skipping as a self-comparison.
          if (draft.worstOverlap == null || draft.worstOverlap.percent < 100) {
            draft.worstOverlap = {
              holdingId: other.id,
              schemeName: other.fund.schemeName,
              percent: 100,
              otherRanksHigher: false,
            };
          }
          continue;
        }

        const percent = overlapPercent(draft.fund, other.fund, fundHoldings);
        if (percent == null) continue;

        if (draft.worstOverlap == null || percent > draft.worstOverlap.percent) {
          draft.worstOverlap = {
            holdingId: other.id,
            schemeName: other.fund.schemeName,
            percent,
            otherRanksHigher: (other.standing ?? 0) > (draft.standing ?? 0),
          };
        }
      }
    }
  }

  const sips: EvaluatedSip[] = sipDrafts.map((draft) => {
    const { verdict, reason } = sipVerdict(draft);
    return { ...draft, signals: sipSignals(draft), verdict, verdictReason: reason };
  });

  /* --- Totals ----------------------------------------------------------- */

  const investedRows = holdings.filter((h) => h.invested != null);
  const valuedRows = holdings.filter((h) => h.currentValue != null);

  const invested =
    investedRows.length > 0 ? investedRows.reduce((sum, h) => sum + h.invested!, 0) : null;
  const currentValue =
    valuedRows.length > 0 ? valuedRows.reduce((sum, h) => sum + h.currentValue!, 0) : null;

  /*
   * Only compare like with like. If some rows have a cost and others do not,
   * summing all values against a partial cost base would report a wildly
   * overstated gain, so the gain is computed over the rows that have both.
   */
  const bothRows = holdings.filter((h) => h.invested != null && h.currentValue != null);
  const bothInvested = bothRows.reduce((sum, h) => sum + h.invested!, 0);
  const bothValue = bothRows.reduce((sum, h) => sum + h.currentValue!, 0);
  const gain = bothRows.length > 0 ? bothValue - bothInvested : null;

  if (bothRows.length > 0 && bothRows.length < holdings.length) {
    notes.push(
      `${holdings.length - bothRows.length} of ${holdings.length} holdings have no cost figure, so the gain is computed over the ${bothRows.length} that do and covers ${formatRupees(bothValue)} of the ${formatRupees(currentValue ?? 0)} total.`,
    );
  }

  let expenseWeighted = 0;
  let expenseCovered = 0;
  let standingWeighted = 0;
  let standingCovered = 0;

  for (const holding of holdings) {
    if (holding.currentValue == null || holding.currentValue <= 0 || !holding.fund) continue;

    const ter = toNumber(holding.fund.expenseRatio);
    if (ter != null) {
      expenseWeighted += ter * holding.currentValue;
      expenseCovered += holding.currentValue;
    }
    if (holding.standing != null) {
      standingWeighted += holding.standing * holding.currentValue;
      standingCovered += holding.currentValue;
    }
  }

  const weightedExpenseRatio = expenseCovered > 0 ? round(expenseWeighted / expenseCovered, 3) : null;

  /* --- Allocation, concentration --------------------------------------- */

  const target = input.targetAllocation ? normaliseAllocation(input.targetAllocation) : null;

  const byClass = new Map<AssetClass, number>();
  for (const holding of holdings) {
    if (holding.assetClass == null || holding.currentValue == null) continue;
    byClass.set(holding.assetClass, (byClass.get(holding.assetClass) ?? 0) + holding.currentValue);
  }

  const classTotal = [...byClass.values()].reduce((sum, value) => sum + value, 0);

  const allocation: AllocationRow[] = ASSET_CLASSES.filter(
    (cls) => (byClass.get(cls) ?? 0) > 0 || (target?.[cls] ?? 0) > 0,
  ).map((cls) => {
    const amount = byClass.get(cls) ?? 0;
    const currentPercent = classTotal > 0 ? (amount / classTotal) * 100 : 0;
    const targetPercent = target?.[cls] ?? (target ? 0 : null);

    return {
      assetClass: cls,
      amount,
      currentPercent: round(currentPercent, 1),
      targetPercent: targetPercent == null ? null : round(targetPercent, 1),
      driftPoints: targetPercent == null ? null : round(currentPercent - targetPercent, 1),
    };
  });

  const groupConcentration = (
    keyOf: (holding: EvaluatedHolding) => string | null,
  ): ConcentrationRow[] => {
    const buckets = new Map<string, { amount: number; funds: Set<string> }>();

    for (const holding of holdings) {
      const key = keyOf(holding);
      if (key == null || holding.currentValue == null) continue;

      const bucket = buckets.get(key) ?? { amount: 0, funds: new Set<string>() };
      bucket.amount += holding.currentValue;
      if (holding.fund) bucket.funds.add(holding.fund.id);
      buckets.set(key, bucket);
    }

    const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.amount, 0);

    return [...buckets.entries()]
      .map(([label, bucket]) => ({
        label,
        amount: bucket.amount,
        percent: total > 0 ? round((bucket.amount / total) * 100, 1) : 0,
        fundCount: bucket.funds.size,
      }))
      .sort((a, b) => b.amount - a.amount);
  };

  const amcConcentration = groupConcentration((h) => h.fund?.fundHouse ?? null);
  const subCategoryConcentration = groupConcentration(
    (h) => (h.fund ? h.fund.subCategory || h.fund.category : null),
  );

  const lookThrough = fundHoldings ? buildLookThrough(holdings, fundHoldings) : null;

  /* --- SIP totals ------------------------------------------------------- */

  const monthlyIntoWeak = activeSips
    .filter(
      (draft) =>
        draft.standing != null &&
        draft.standing < WEAK_STANDING &&
        draft.breakdown?.hasSufficientData &&
        // A tracker below its active peers is not money going somewhere weak.
        !draft.isPassive,
    )
    .reduce((sum, draft) => sum + (draft.monthlyEquivalent ?? 0), 0);

  const unknownFrequency = activeSips.filter((draft) => draft.monthlyEquivalent == null).length;

  const sipTotals: SipTotals = {
    monthlyTotal: activeSips.length > 0 ? round(monthlyTotal) : null,
    annualTotal: activeSips.length > 0 ? round(monthlyTotal * 12) : null,
    activeCount: activeSips.length,
    monthlyIntoWeak: activeSips.length > 0 ? round(monthlyIntoWeak) : null,
  };

  if (unknownFrequency > 0) {
    notes.push(
      `${unknownFrequency} active SIP${unknownFrequency === 1 ? '' : 's'} had no readable frequency, so ${unknownFrequency === 1 ? 'it is' : 'they are'} excluded from the monthly and annual totals.`,
    );
  }

  const unmatchedHoldings = holdings.filter((h) => h.fund == null);
  if (unmatchedHoldings.length > 0) {
    const money = unmatchedHoldings.reduce((sum, h) => sum + (h.currentValue ?? 0), 0);
    notes.push(
      `${unmatchedHoldings.length} holding${unmatchedHoldings.length === 1 ? '' : 's'} could not be matched to the dataset${money > 0 ? ` (${formatRupees(money)})` : ''}, so ${unmatchedHoldings.length === 1 ? 'it is' : 'they are'} excluded from every ranking, allocation and overlap figure.`,
    );
  }

  const noDate = holdings.filter((h) => h.fund != null && h.holdingMonths == null).length;
  if (noDate > 0) {
    notes.push(
      `${noDate} holding${noDate === 1 ? '' : 's'} have no purchase date, so exit load and capital gains on a switch could not be worked out for ${noDate === 1 ? 'it' : 'them'}.`,
    );
  }

  if (!fundHoldings || fundHoldings.size === 0) {
    notes.push(
      'Stock-level holdings data is unavailable, so overlap between your funds and the look-through to individual stocks could not be computed. Two of your funds may hold much the same portfolio.',
    );
  }

  if (input.slabRatePercent == null) {
    const slabTaxed = holdings.filter(
      (h) => h.fund != null && h.switchCost != null && h.switchCost.taxAmount == null && h.gain != null && h.gain > 0,
    ).length;
    if (slabTaxed > 0) {
      notes.push(
        `${slabTaxed} holding${slabTaxed === 1 ? '' : 's'} are taxed at your slab rate rather than a flat one. Set a marginal rate to see what switching ${slabTaxed === 1 ? 'it' : 'them'} would cost.`,
      );
    }
  }

  return {
    holdings,
    sips,
    totals: {
      invested,
      currentValue,
      gain,
      gainPercent: gain != null && bothInvested > 0 ? round((gain / bothInvested) * 100, 2) : null,
      rowCount: holdings.length,
      matchedCount: holdings.filter((h) => h.fund != null).length,
    },
    sipTotals,
    weightedExpenseRatio,
    annualCostRupees:
      weightedExpenseRatio != null && expenseCovered > 0
        ? round(expenseCovered * (weightedExpenseRatio / 100))
        : null,
    weightedStanding: standingCovered > 0 ? round(standingWeighted / standingCovered, 1) : null,
    allocation,
    amcConcentration,
    subCategoryConcentration,
    overlapPairs,
    lookThrough,
    suggestions: buildSuggestions({
      holdings,
      sips,
      overlapPairs,
      amcConcentration,
      subCategoryConcentration,
      allocation,
      lookThrough,
      sipTotals,
      weightedExpenseRatio,
      annualCostRupees:
        weightedExpenseRatio != null && expenseCovered > 0
          ? round(expenseCovered * (weightedExpenseRatio / 100))
          : null,
      currentValue,
    }),
    notes,
  };
};

/* ---------------------------------------------------------------------------
 * Portfolio-level suggestions
 * ------------------------------------------------------------------------- */

interface SuggestionInput {
  holdings: EvaluatedHolding[];
  sips: EvaluatedSip[];
  overlapPairs: OverlapPairRow[];
  amcConcentration: ConcentrationRow[];
  subCategoryConcentration: ConcentrationRow[];
  allocation: AllocationRow[];
  lookThrough: LookThrough | null;
  sipTotals: SipTotals;
  weightedExpenseRatio: number | null;
  annualCostRupees: number | null;
  currentValue: number | null;
}

/**
 * Observations about the portfolio as a whole rather than any one fund.
 *
 * Ordered by how much money each one is about, not by how alarming it sounds —
 * a 70% overlap between two ₹5,000 positions matters less than an asset mix that
 * is 40 points off target.
 */
const buildSuggestions = (input: SuggestionInput): Suggestion[] => {
  const suggestions: Suggestion[] = [];
  const {
    holdings,
    sips,
    overlapPairs,
    amcConcentration,
    subCategoryConcentration,
    allocation,
    lookThrough,
    sipTotals,
  } = input;

  const duplicates = overlapPairs.filter((pair) => pair.percent >= DUPLICATE_OVERLAP_PERCENT);
  if (duplicates.length > 0) {
    const money = duplicates.reduce((sum, pair) => sum + (pair.combinedAmount ?? 0), 0);
    suggestions.push({
      id: 'duplicate-bets',
      severity: 'bad',
      title: `${duplicates.length} pair${duplicates.length === 1 ? '' : 's'} of funds are largely the same bet`,
      detail: `${duplicates
        .slice(0, 3)
        .map((pair) => `${pair.aName} and ${pair.bName} share ${pair.percent.toFixed(0)}% of holdings`)
        .join('; ')}${duplicates.length > 3 ? `; and ${duplicates.length - 3} more` : ''}.${
        money > 0 ? ` ${formatRupees(money)} sits across these pairs.` : ''
      } Holding both is more funds, not more diversification.`,
    });
  }

  const valuedHoldings = holdings.filter(
    (holding) => holding.fund != null && holding.currentValue != null && holding.currentValue > 0,
  ).length;

  const topAmc = amcConcentration[0];
  if (
    topAmc &&
    valuedHoldings >= MIN_HOLDINGS_FOR_AMC_CONCENTRATION &&
    topAmc.percent > OVERWEIGHT_AMC_PERCENT
  ) {
    suggestions.push({
      id: 'amc-concentration',
      severity: 'warn',
      title: `${topAmc.percent.toFixed(0)}% of the portfolio is with one fund house`,
      detail: `${formatRupees(topAmc.amount)} across ${topAmc.fundCount} scheme${topAmc.fundCount === 1 ? '' : 's'} at ${topAmc.label}. Schemes at one AMC often share a research desk and a house view, so their funds tend to move together more than their categories suggest.`,
    });
  }

  const crowded = subCategoryConcentration.filter((row) => row.fundCount > 2);
  if (crowded.length > 0) {
    suggestions.push({
      id: 'sub-category-crowding',
      severity: 'warn',
      title: `More than two funds in the same sub-category`,
      detail: `${crowded
        .map((row) => `${row.fundCount} in ${row.label} (${row.percent.toFixed(0)}% of the portfolio)`)
        .join('; ')}. Funds in one sub-category are bound by the same SEBI mandate, so the third and fourth add paperwork and tax lots rather than exposure.`,
    });
  }

  const drifted = allocation
    .filter((row) => row.driftPoints != null && Math.abs(row.driftPoints) >= ALLOCATION_DRIFT_POINTS)
    .sort((a, b) => Math.abs(b.driftPoints!) - Math.abs(a.driftPoints!));

  if (drifted.length > 0) {
    suggestions.push({
      id: 'allocation-drift',
      severity: 'warn',
      title: 'Asset mix is off the target you set',
      detail: `${drifted
        .map(
          (row) =>
            `${ASSET_CLASS_LABEL[row.assetClass]} is ${row.currentPercent.toFixed(0)}% against a ${row.targetPercent!.toFixed(0)}% target (${row.driftPoints! > 0 ? '+' : ''}${row.driftPoints!.toFixed(0)} points)`,
        )
        .join('; ')}. Drift can be corrected with new money instead of selling, which costs nothing in tax or exit load.`,
    });
  }

  const exits = holdings.filter((holding) => holding.verdict === 'exit');
  if (exits.length > 0) {
    const money = exits.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0);
    suggestions.push({
      id: 'switch-candidates',
      severity: 'warn',
      title: `${exits.length} holding${exits.length === 1 ? '' : 's'} where switching looks worth its cost`,
      detail: `${formatRupees(money)} in ${exits.map((holding) => holding.fund?.schemeName ?? holding.holding.sourceName).join('; ')}. Each one clears both tests: a materially better-ranked peer exists, and the load plus tax is either negligible or recovered by the return gap within ${QUICK_BREAK_EVEN_YEARS} years.`,
    });
  }

  const redirects = sips.filter((sip) => sip.verdict === 'redirect' && sip.sip.active);
  if (redirects.length > 0) {
    const money = redirects.reduce((sum, sip) => sum + (sip.monthlyEquivalent ?? 0), 0);
    suggestions.push({
      id: 'sip-redirects',
      severity: 'warn',
      title: `${formatRupees(money)} a month is going into ${redirects.length} fund${redirects.length === 1 ? '' : 's'} worth redirecting`,
      detail: `${redirects.map((sip) => sip.fund?.schemeName ?? sip.sip.sourceName).join('; ')}. Unlike selling, moving future instalments costs nothing — no exit load, no capital gains, nothing realised — so the bar for changing them is much lower than for the units you already hold.`,
    });
  }

  if (sipTotals.monthlyIntoWeak != null && sipTotals.monthlyIntoWeak > 0 && sipTotals.monthlyTotal) {
    const share = (sipTotals.monthlyIntoWeak / sipTotals.monthlyTotal) * 100;
    suggestions.push({
      id: 'sip-quality-share',
      severity: 'info',
      title: `${share.toFixed(0)}% of monthly instalments go into bottom-ranked funds`,
      detail: `${formatRupees(sipTotals.monthlyIntoWeak)} of ${formatRupees(sipTotals.monthlyTotal)} a month goes into funds in the bottom ${WEAK_STANDING}% of their sub-category, which is ${formatRupees(sipTotals.monthlyIntoWeak * 12)} a year of new money.`,
    });
  }

  if (input.annualCostRupees != null && input.weightedExpenseRatio != null) {
    suggestions.push({
      id: 'annual-cost',
      severity: 'info',
      title: `Fees cost about ${formatRupees(input.annualCostRupees)} a year`,
      detail: `A money-weighted expense ratio of ${input.weightedExpenseRatio.toFixed(2)}%. This is already deducted from NAV daily rather than billed, so it never appears as a charge — but it is the only cost here that is certain in advance.`,
    });
  }

  if (lookThrough && lookThrough.uniqueIssuers > 0) {
    suggestions.push({
      id: 'look-through',
      severity: lookThrough.topTenPercent > 45 ? 'warn' : 'info',
      title: `Your equity funds resolve to ${lookThrough.uniqueIssuers} companies, with the top 10 at ${lookThrough.topTenPercent.toFixed(0)}%`,
      detail: `${lookThrough.top
        .slice(0, 3)
        .map((stock) => `${stock.name} ${stock.percent.toFixed(1)}%`)
        .join(', ')} lead. Measured across the ${lookThrough.coveragePercent.toFixed(0)}% of your equity money whose fund holdings are published, and only the top 20 per fund are — so true concentration is a little higher than this.`,
    });
  }

  const matched = holdings.filter((holding) => holding.fund != null);
  if (matched.length > 10) {
    suggestions.push({
      id: 'fund-count',
      severity: 'info',
      title: `${matched.length} funds is a lot to hold`,
      detail: `Each one is a separate set of tax lots to reconcile at redemption, and the ${matched.length}th fund adds exposure only if it holds something the other ${matched.length - 1} do not. The overlap and look-through figures above are the check on whether it does.`,
    });
  }

  const keepers = holdings.filter((holding) => holding.verdict === 'keep');
  if (keepers.length > 0 && exits.length === 0 && duplicates.length === 0) {
    suggestions.push({
      id: 'nothing-pressing',
      severity: 'good',
      title: 'Nothing here clears the bar for switching',
      detail: `${keepers.length} of ${matched.length} matched holdings rank respectably against their own peers with no duplication flagged. Since leaving a position costs exit load and capital gains tax, "no change" is a real answer rather than a non-answer.`,
    });
  }

  return suggestions;
};
