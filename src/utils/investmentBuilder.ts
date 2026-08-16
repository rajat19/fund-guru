import { MutualFund, RiskLevel } from '@/types/mutualFund';
import {
  ASSET_CLASS_LABEL,
  AssetAllocation,
  AssetClass,
  classifyAssetClass,
  normaliseAllocation,
} from '@/utils/assetClass';
import {
  ScoringContext,
  ScoredFund,
  rankFundsWithContext,
  scoreFund,
} from '@/utils/scoringEngine';
import { overlapPercent, type HoldingsIndex } from '@/utils/overlap';
import { toNumber } from '@/utils/number';
import { trackRecordOf } from '@/utils/trackRecord';

/**
 * Investment builder
 * ==================
 *
 * Turns a set of rules plus an amount into a concrete split across funds.
 *
 * The hard part is not picking high-scoring funds — that is just the existing
 * ranking. It is everything that makes a *list* of good funds into a *portfolio*:
 *
 *  - Five top-ranked large-cap funds hold largely the same stocks. Diversifying
 *    across funds is not the same as diversifying across holdings, and a plan
 *    that ignores that gives a false sense of spread.
 *  - Schemes have minimum investments (observed: ₹100, ₹1,000, ₹5,000). Splitting
 *    ₹50,000 ten ways lands at ₹5,000, which is exactly some funds' floor, so
 *    allocations that look fine on paper are not actually placeable.
 *  - Amounts must reconcile to the input exactly. Rounding each share
 *    independently leaves the total off by hundreds of rupees.
 *
 * Every compromise the builder makes is reported in `warnings` rather than
 * silently applied.
 */

export interface DiversificationRules {
  /** Maximum funds from a single AMC across the whole plan. */
  maxPerFundHouse: number;
  /** Maximum funds sharing a sub-category within an asset class. */
  maxPerSubCategory: number;
  /**
   * Reject a candidate whose holdings overlap an already-picked fund by more
   * than this percentage. Ignored when holdings data is unavailable.
   */
  maxOverlapPercent: number;
}

export const DEFAULT_DIVERSIFICATION: DiversificationRules = {
  maxPerFundHouse: 2,
  maxPerSubCategory: 1,
  maxOverlapPercent: 55,
};

export type InvestmentMode = 'lumpsum' | 'sip';

/**
 * SIP is not a relabelled lumpsum. Three things genuinely differ:
 *
 *  1. **The binding minimum.** Across 1,556 live funds the median lumpsum
 *     minimum is ₹1,000 while the median SIP minimum is ₹200, and 880 funds set
 *     a lower SIP minimum than lumpsum. At a ₹500 per-fund share, 674 funds are
 *     affordable by the lumpsum rule against 1,349 by the SIP rule. Applying the
 *     lumpsum minimum to a SIP would wrongly exclude half the universe.
 *  2. **Not every scheme accepts one.** 27 of 1,659 sampled schemes report
 *     sip_allowed: false — mostly target-maturity and gilt index funds.
 *  3. **Rounding.** Monthly instalments are set in round hundreds, not the
 *     arbitrary amounts a lumpsum can take.
 *
 * What deliberately does NOT differ is the return basis. The feed exposes SIP
 * XIRR fields, but they are unusable: the camelCase variants report an identical
 * value for 3Y and 5Y in 100% of sampled funds, and the two casings disagree on
 * every fund. Ranking therefore still uses lumpsum trailing returns in both
 * modes, which is imperfect for a SIP and better than a number we cannot read.
 */
export interface BuilderInput {
  /**
   * Rupees to deploy — total for a lumpsum, per month for a SIP.
   */
  totalAmount: number;
  /** Defaults to lumpsum. */
  mode?: InvestmentMode;
  /** Highest riskometer bucket the user will hold. */
  maxRisk: RiskLevel;
  /** Target split across asset classes; normalised internally. */
  allocation: AssetAllocation;
  /** Total number of funds wanted across the whole plan. */
  fundCount: number;
  /** Minimum years of history a fund must have. */
  minTrackRecordYears?: number;
  diversification?: Partial<DiversificationRules>;
  /** Equal rupees per fund, or weighted by peer score. */
  weighting?: 'equal' | 'score';
  /** Round allocations to this multiple. */
  roundTo?: number;
  holdings?: HoldingsIndex;
  /**
   * Funds the user insists on holding — researched picks, or existing positions.
   *
   * Passed as resolved objects rather than ids because a fund someone already
   * holds may fail their own screening rules, so it will not be in `candidates`.
   * Pins bypass every filter and are reported when they do; silently dropping a
   * fund the user explicitly asked for would be the worst outcome, and silently
   * including one that fails their rules would be misleading.
   */
  pinnedFunds?: MutualFund[];
  /** Fund ids the user has removed from the plan. Never re-selected. */
  excludedIds?: string[];
}

export interface PlannedFund {
  fund: ScoredFund;
  assetClass: AssetClass;
  amount: number;
  /** Share of the whole plan, in percent. */
  percent: number;
  /** Highest overlap with any other fund in the plan, when known. */
  maxOverlapPercent: number | null;
  overlapWith: string | null;
}

export interface AssetClassPlan {
  assetClass: AssetClass;
  targetPercent: number;
  targetAmount: number;
  allocatedAmount: number;
  funds: PlannedFund[];
  /** Set when the class could not be filled as requested. */
  shortfallReason: string | null;
}

export interface Portfolio {
  totalAmount: number;
  /** Sum of all allocations. Equals totalAmount unless something was unplaceable. */
  allocatedAmount: number;
  unallocatedAmount: number;
  classes: AssetClassPlan[];
  funds: PlannedFund[];
  /** AUM-weighted expense ratio of the resulting portfolio. */
  weightedExpenseRatio: number | null;
  /** Worst pairwise holdings overlap in the plan, when known. */
  worstOverlapPercent: number | null;
  warnings: string[];
}

const RISK_ORDER: RiskLevel[] = ['Low', 'Moderate', 'High', 'Very High'];

const withinRisk = (fund: MutualFund, maxRisk: RiskLevel): boolean => {
  const risk = fund.riskMetrics.risk;
  if (!risk) return maxRisk === 'Very High';
  return RISK_ORDER.indexOf(risk) <= RISK_ORDER.indexOf(maxRisk);
};

/**
 * The minimum that actually binds for the chosen mode.
 *
 * Falls back to the lumpsum minimum when a fund reports no SIP minimum, rather
 * than treating it as zero — an absent value means unknown, and assuming "no
 * minimum" would produce plans that cannot be executed.
 */
const minInvestmentOf = (fund: MutualFund, mode: InvestmentMode = 'lumpsum'): number => {
  if (mode === 'sip') {
    return toNumber(fund.minSipInvestment) ?? toNumber(fund.minInvestment) ?? 0;
  }
  return toNumber(fund.minInvestment) ?? 0;
};

/** Schemes that accept no SIP. Undefined means an older dataset — assume allowed. */
const acceptsSip = (fund: MutualFund): boolean => fund.sipAllowed !== false;

/**
 * Split a total into per-class targets whose rupee amounts sum exactly to the
 * total, using largest-remainder so no rupee is lost to rounding.
 */
const splitByWeight = (
  total: number,
  weights: Array<{ key: string; weight: number }>,
  roundTo: number,
): Map<string, number> => {
  const result = new Map<string, number>();
  if (weights.length === 0) return result;

  const units = Math.floor(total / roundTo);
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0 || units <= 0) {
    weights.forEach((w) => result.set(w.key, 0));
    return result;
  }

  const exact = weights.map((w) => ({ ...w, ideal: (w.weight / totalWeight) * units }));
  const floored = exact.map((w) => ({ ...w, base: Math.floor(w.ideal) }));

  let assigned = floored.reduce((sum, w) => sum + w.base, 0);
  const remainder = [...floored].sort(
    (a, b) => b.ideal - b.base - (a.ideal - a.base) || b.weight - a.weight,
  );

  let i = 0;
  while (assigned < units && remainder.length > 0) {
    remainder[i % remainder.length].base += 1;
    assigned += 1;
    i += 1;
  }

  floored.forEach((w) => result.set(w.key, w.base * roundTo));
  return result;
};

interface SelectionState {
  perHouse: Map<string, number>;
  picked: ScoredFund[];
}

/**
 * Greedy pick of `count` funds from `ranked`, applying diversification rules and
 * relaxing them only when the target cannot otherwise be met.
 *
 * Relaxation is ordered by how much each rule protects the investor: holdings
 * overlap is the real diversification constraint, so it is given up last.
 */
const selectFunds = (
  ranked: ScoredFund[],
  count: number,
  rules: DiversificationRules,
  state: SelectionState,
  holdings: HoldingsIndex | undefined,
  onRelax: (message: string) => void,
): ScoredFund[] => {
  const chosen: ScoredFund[] = [];
  const perSubCategory = new Map<string, number>();

  const stages: Array<{ label: string; rules: DiversificationRules }> = [
    { label: '', rules },
    {
      label: `allowed more than ${rules.maxPerSubCategory} fund per sub-category`,
      rules: { ...rules, maxPerSubCategory: Number.POSITIVE_INFINITY },
    },
    {
      label: `allowed more than ${rules.maxPerFundHouse} funds per AMC`,
      rules: {
        ...rules,
        maxPerSubCategory: Number.POSITIVE_INFINITY,
        maxPerFundHouse: Number.POSITIVE_INFINITY,
      },
    },
    {
      label: `accepted holdings overlap above ${rules.maxOverlapPercent}%`,
      rules: {
        maxPerSubCategory: Number.POSITIVE_INFINITY,
        maxPerFundHouse: Number.POSITIVE_INFINITY,
        maxOverlapPercent: 100,
      },
    },
  ];

  for (const [stageIndex, stage] of stages.entries()) {
    if (chosen.length >= count) break;
    const before = chosen.length;

    for (const candidate of ranked) {
      if (chosen.length >= count) break;
      if (chosen.some((f) => f.id === candidate.id)) continue;

      const house = candidate.fundHouse || 'unknown';
      if ((state.perHouse.get(house) ?? 0) >= stage.rules.maxPerFundHouse) continue;

      const sub = candidate.subCategory || candidate.category;
      if ((perSubCategory.get(sub) ?? 0) >= stage.rules.maxPerSubCategory) continue;

      if (holdings && stage.rules.maxOverlapPercent < 100) {
        const clash = [...state.picked, ...chosen].some((existing) => {
          const overlap = overlapPercent(candidate, existing, holdings);
          return overlap != null && overlap > stage.rules.maxOverlapPercent;
        });
        if (clash) continue;
      }

      chosen.push(candidate);
      state.perHouse.set(house, (state.perHouse.get(house) ?? 0) + 1);
      perSubCategory.set(sub, (perSubCategory.get(sub) ?? 0) + 1);
    }

    // Report a relaxation when it actually contributed a pick, not only when the
    // stage still came up short — a plan that needed the rule dropped has to say
    // so even if dropping it succeeded.
    if (stageIndex > 0 && chosen.length > before) onRelax(stage.label);
  }

  state.picked.push(...chosen);
  return chosen;
};

/**
 * Distribute a class's amount across its funds, dropping any fund whose share
 * falls below its scheme minimum and redistributing to the rest.
 *
 * Iterative because dropping a fund raises everyone else's share, which can make
 * a previously-unplaceable fund placeable and vice versa.
 */
/**
 * Score a pinned fund directly.
 *
 * rankFundsWithContext deliberately drops funds with too little data to rank,
 * which is right for automatic selection and wrong for a pin: the user named
 * this fund, so it goes in whatever its coverage.
 */
const scorePinned = (fund: MutualFund, context: ScoringContext): ScoredFund => {
  const breakdown = scoreFund(fund, context);
  return { ...fund, score: breakdown.score, breakdown, rank: 0 };
};

const allocateWithinClass = (
  funds: ScoredFund[],
  amount: number,
  weighting: 'equal' | 'score',
  roundTo: number,
  onDrop: (fund: ScoredFund, share: number) => void,
  /** Pins, which are warned about rather than dropped when their share is short. */
  protectedIds: Set<string>,
  onUnderMinimum: (fund: ScoredFund, share: number) => void,
  mode: InvestmentMode,
): Map<string, number> => {
  let eligible = [...funds];

  for (let guard = 0; guard < funds.length + 1; guard++) {
    if (eligible.length === 0) return new Map();

    const weights = eligible.map((fund) => ({
      key: fund.id,
      // Score-weighting uses the score above a neutral 50 so a 60 does not get
      // merely 20% more than a 50 — it gets meaningfully more.
      weight: weighting === 'score' ? Math.max(1, fund.score - 40) : 1,
    }));

    const split = splitByWeight(amount, weights, roundTo);

    const tooSmall = eligible.filter((fund) => {
      const share = split.get(fund.id) ?? 0;
      const min = minInvestmentOf(fund, mode);
      return min > 0 && share < min;
    });

    if (tooSmall.length === 0) return split;

    const droppable = tooSmall.filter((f) => !protectedIds.has(f.id));

    if (droppable.length === 0) {
      // Only pins are under their minimum. Report and keep them: the user asked
      // for these funds, and an unexecutable plan they can see how to fix beats a
      // plan that quietly omits what they requested.
      for (const fund of tooSmall) onUnderMinimum(fund, split.get(fund.id) ?? 0);
      return split;
    }

    // Drop the worst-scoring offender only, so one tiny share does not evict a
    // whole class at once.
    const drop = droppable.reduce((worst, f) => (f.score < worst.score ? f : worst));
    onDrop(drop, split.get(drop.id) ?? 0);
    eligible = eligible.filter((f) => f.id !== drop.id);
  }

  return new Map();
};

export const buildPortfolio = (
  candidates: MutualFund[],
  context: ScoringContext,
  input: BuilderInput,
): Portfolio => {
  const warnings: string[] = [];
  const mode: InvestmentMode = input.mode ?? 'lumpsum';
  // Monthly instalments are set in round hundreds; a lumpsum can be any figure.
  const roundTo = Math.max(1, input.roundTo ?? (mode === 'sip' ? 100 : 100));
  const weighting = input.weighting ?? 'equal';
  const rules = { ...DEFAULT_DIVERSIFICATION, ...input.diversification };
  const minYears = input.minTrackRecordYears ?? 3;

  const allocation = normaliseAllocation(input.allocation);
  const classes = Object.keys(allocation) as AssetClass[];

  if (classes.length === 0) {
    return {
      totalAmount: input.totalAmount,
      allocatedAmount: 0,
      unallocatedAmount: input.totalAmount,
      classes: [],
      funds: [],
      weightedExpenseRatio: null,
      worstOverlapPercent: null,
      warnings: ['No asset allocation set — give at least one asset class a weight above zero.'],
    };
  }

  /*
   * Removing a fund re-solves the plan rather than sliding "the next best" into
   * the vacated slot. Selection is constrained — asset-class targets, one fund
   * per sub-category, a cap per AMC, an overlap ceiling — so a replacement has
   * to be legal against the funds that remain, which a precomputed flat ranking
   * cannot know. Re-solving is also cheap: it is a greedy walk over an in-memory
   * list, so earlier picks are unaffected and only the freed slot changes hands.
   */
  const excludedIds = new Set(input.excludedIds ?? []);

  const pinnedFunds = (input.pinnedFunds ?? []).filter((fund) => !excludedIds.has(fund.id));
  const pinnedIds = new Set(pinnedFunds.map((fund) => fund.id));

  // Screen once: risk band, track record, and enough data to rank on. Pins are
  // held out of the screen entirely and merged back in per class.
  const eligible = candidates.filter((fund) => {
    if (excludedIds.has(fund.id)) return false;
    if (pinnedIds.has(fund.id)) return false;
    if (mode === 'sip' && !acceptsSip(fund)) return false;
    if (!withinRisk(fund, input.maxRisk)) return false;
    if (trackRecordOf(fund).years < minYears) return false;
    return true;
  });

  if (mode === 'sip') {
    const rejected = candidates.filter(
      (fund) => !acceptsSip(fund) && !excludedIds.has(fund.id) && !pinnedIds.has(fund.id),
    ).length;
    if (rejected > 0) {
      warnings.push(
        `${rejected} fund${rejected === 1 ? '' : 's'} excluded for not accepting a SIP.`,
      );
    }
  }

  // Say so when a pin fails the user's own rules, rather than letting it sit in
  // the plan looking like it passed.
  for (const fund of pinnedFunds) {
    const reasons: string[] = [];
    if (mode === 'sip' && !acceptsSip(fund)) reasons.push('does not accept a SIP');
    if (!withinRisk(fund, input.maxRisk)) reasons.push(`risk is ${fund.riskMetrics.risk}`);
    const years = trackRecordOf(fund).years;
    if (years < minYears) reasons.push(`only ${years.toFixed(years < 1 ? 1 : 0)}y of history`);
    if (reasons.length > 0) {
      warnings.push(
        `${fund.schemeName} is pinned and kept despite failing your filters (${reasons.join(', ')}).`,
      );
    }
  }

  if (eligible.length === 0 && pinnedFunds.length === 0) {
    return {
      totalAmount: input.totalAmount,
      allocatedAmount: 0,
      unallocatedAmount: input.totalAmount,
      classes: [],
      funds: [],
      weightedExpenseRatio: null,
      worstOverlapPercent: null,
      warnings: [
        'No fund passed the filters. Loosen the screening rules, raise the risk ceiling, or reduce the minimum track record.',
      ],
    };
  }

  // Fund counts per class, proportional to the money going into each.
  const classFundCounts = splitByWeight(
    input.fundCount,
    classes.map((cls) => ({ key: cls, weight: allocation[cls] ?? 0 })),
    1,
  );

  // Every class with money in it needs at least one fund.
  for (const cls of classes) {
    if ((classFundCounts.get(cls) ?? 0) < 1) classFundCounts.set(cls, 1);
  }

  const classAmounts = splitByWeight(
    input.totalAmount,
    classes.map((cls) => ({ key: cls, weight: allocation[cls] ?? 0 })),
    roundTo,
  );

  const state: SelectionState = { perHouse: new Map(), picked: [] };
  const plans: AssetClassPlan[] = [];
  const allPlanned: PlannedFund[] = [];

  for (const cls of classes) {
    const targetAmount = classAmounts.get(cls) ?? 0;
    const pool = eligible.filter((fund) => classifyAssetClass(fund) === cls);

    // Pins occupy slots in their own class before anything is auto-selected.
    const classPins = pinnedFunds
      .filter((fund) => classifyAssetClass(fund) === cls)
      .map((fund) => scorePinned(fund, context));

    // Pins win over the requested count. Reducing the count to make room would
    // silently drop a fund the user named.
    const requested = classFundCounts.get(cls) ?? 1;
    const wanted = Math.max(requested, classPins.length);
    if (classPins.length > requested) {
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: holds ${classPins.length} pinned fund${classPins.length === 1 ? '' : 's'}, above the ${requested} this class was allotted.`,
      );
    }

    // Pins count against the AMC cap so auto-selection does not pile onto the
    // same house the user already chose.
    for (const pin of classPins) {
      const house = pin.fundHouse || 'unknown';
      state.perHouse.set(house, (state.perHouse.get(house) ?? 0) + 1);
    }
    state.picked.push(...classPins);

    if (pool.length === 0 && classPins.length === 0) {
      plans.push({
        assetClass: cls,
        targetPercent: allocation[cls] ?? 0,
        targetAmount,
        allocatedAmount: 0,
        funds: [],
        shortfallReason: `No ${ASSET_CLASS_LABEL[cls]} fund passed the filters`,
      });
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: no fund passed the filters, so its ₹${targetAmount.toLocaleString('en-IN')} is unallocated.`,
      );
      continue;
    }

    /*
     * Only consider funds this class can actually afford.
     *
     * Selection is greedy on score and blind to money, so without this it will
     * happily pick the top-ranked fund in the class, discover its share is under
     * the scheme minimum, drop it, and leave the class empty — even when
     * hundreds of cheaper funds would have taken the money. Observed on real
     * data: a ₹1,500 debt share picked a fund with a ₹5,000 minimum and
     * allocated nothing, while 442 other debt funds accepted ₹1,500.
     *
     * Rather than repairing that after the fact, work out the largest fund count
     * the class can actually support and filter the pool to funds that clear the
     * resulting per-fund share. Fewer, funded funds beat more, unfunded ones.
     */
    let affordablePool = pool;
    let affordableCount = wanted;

    for (let n = wanted; n >= 1; n--) {
      const share = Math.floor(targetAmount / n);
      const affordable = pool.filter((fund) => minInvestmentOf(fund, mode) <= share);
      if (affordable.length >= n - classPins.length) {
        affordablePool = affordable;
        affordableCount = n;
        break;
      }
      if (n === 1) {
        affordablePool = [];
        affordableCount = 0;
      }
    }

    if (affordableCount < wanted && affordableCount > 0) {
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: ₹${targetAmount.toLocaleString('en-IN')} supports ${affordableCount} fund${affordableCount === 1 ? '' : 's'} at${mode === 'sip' ? ' SIP' : ''} scheme minimums, not ${wanted}.`,
      );
    }

    // rankFundsWithContext drops funds without enough data to rank, which is
    // right for a plan but must not be invisible — otherwise a class silently
    // comes back short with no explanation.
    const ranked = rankFundsWithContext(affordablePool, context);
    const excluded = affordablePool.length - ranked.length;
    if (excluded > 0 && ranked.length + classPins.length < affordableCount) {
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: ${excluded} of ${affordablePool.length} affordable funds were skipped for having too little data to rank.`,
      );
    }

    const relaxations: string[] = [];
    const autoSelected = selectFunds(
      ranked,
      Math.max(0, affordableCount - classPins.length),
      rules,
      state,
      input.holdings,
      (msg) => relaxations.push(msg),
    );

    // Pins first so they lead the class in the rendered plan.
    const selected = [...classPins, ...autoSelected];

    if (relaxations.length > 0) {
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: to reach ${affordableCount} fund${affordableCount === 1 ? '' : 's'} the builder ${[...new Set(relaxations)].join(' and ')}.`,
      );
    }

    const dropped: string[] = [];
    const underMinimum: string[] = [];
    const amounts = allocateWithinClass(
      selected,
      targetAmount,
      weighting,
      roundTo,
      (fund, share) =>
        dropped.push(
          `${fund.schemeName} (share ₹${share.toLocaleString('en-IN')} below its ₹${minInvestmentOf(fund, mode).toLocaleString('en-IN')} minimum)`,
        ),
      pinnedIds,
      (fund, share) =>
        underMinimum.push(
          `${fund.schemeName} gets ₹${share.toLocaleString('en-IN')} but needs ₹${minInvestmentOf(fund, mode).toLocaleString('en-IN')}`,
        ),
      mode,
    );

    if (underMinimum.length > 0) {
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: pinned fund${underMinimum.length === 1 ? '' : 's'} below the scheme minimum — ${underMinimum.join('; ')}. Raise the amount or hold fewer funds.`,
      );
    }

    if (dropped.length > 0) {
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: dropped ${dropped.length} fund${dropped.length === 1 ? '' : 's'} whose share fell below the scheme minimum — ${dropped.join('; ')}.`,
      );
    }

    const planned: PlannedFund[] = selected
      .filter((fund) => (amounts.get(fund.id) ?? 0) > 0)
      .map((fund) => ({
        fund,
        assetClass: cls,
        amount: amounts.get(fund.id) ?? 0,
        percent: 0,
        maxOverlapPercent: null,
        overlapWith: null,
      }));

    const allocatedAmount = planned.reduce((sum, p) => sum + p.amount, 0);

    if (allocatedAmount < targetAmount && planned.length > 0) {
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: ₹${(targetAmount - allocatedAmount).toLocaleString('en-IN')} left over after rounding to ₹${roundTo} multiples.`,
      );
    }

    plans.push({
      assetClass: cls,
      targetPercent: allocation[cls] ?? 0,
      targetAmount,
      allocatedAmount,
      funds: planned,
      shortfallReason:
        planned.length < wanted
          ? `Only ${planned.length} of ${wanted} funds could be placed`
          : null,
    });
    allPlanned.push(...planned);
  }

  const allocatedAmount = allPlanned.reduce((sum, p) => sum + p.amount, 0);

  for (const p of allPlanned) {
    p.percent = allocatedAmount > 0 ? (p.amount / allocatedAmount) * 100 : 0;
  }

  // Pairwise overlap across the finished plan, for reporting.
  let worstOverlapPercent: number | null = null;
  if (input.holdings) {
    for (const a of allPlanned) {
      for (const b of allPlanned) {
        if (a.fund.id === b.fund.id) continue;
        const overlap = overlapPercent(a.fund, b.fund, input.holdings);
        if (overlap == null) continue;
        if (a.maxOverlapPercent == null || overlap > a.maxOverlapPercent) {
          a.maxOverlapPercent = overlap;
          a.overlapWith = b.fund.schemeName;
        }
        if (worstOverlapPercent == null || overlap > worstOverlapPercent) {
          worstOverlapPercent = overlap;
        }
      }
    }

    if (worstOverlapPercent != null && worstOverlapPercent > rules.maxOverlapPercent) {
      warnings.push(
        `Two funds in this plan overlap by ${worstOverlapPercent.toFixed(0)}% of holdings — they are largely the same bet.`,
      );
    }
  }

  // Expense ratio weighted by the money actually going into each fund.
  let expenseWeighted = 0;
  let expenseCovered = 0;
  for (const p of allPlanned) {
    const er = toNumber(p.fund.expenseRatio);
    if (er == null) continue;
    expenseWeighted += er * p.amount;
    expenseCovered += p.amount;
  }

  const lockedIn = allPlanned.filter((p) => (toNumber(p.fund.lockInMonths) ?? 0) > 0);
  if (lockedIn.length > 0) {
    const names = lockedIn.map((p) => p.fund.schemeName).join('; ');

    if (mode === 'sip') {
      /*
       * A lock-in behaves quite differently under a SIP, and saying only "cannot
       * be redeemed early" would understate it. Each instalment locks from its
       * own date, so the money is not free three years after you start — it is
       * free three years after the *last* instalment, and a rolling portion stays
       * locked for as long as the SIP runs.
       */
      const longest = Math.max(...lockedIn.map((p) => toNumber(p.fund.lockInMonths) ?? 0));
      warnings.push(
        `${lockedIn.length} fund${lockedIn.length === 1 ? '' : 's'} in this plan have a lock-in, and under a SIP every instalment locks from its own date — so a portion stays locked until ${Math.round(longest)} months after your final instalment, not after the first: ${names}.`,
      );
    } else {
      warnings.push(
        `${lockedIn.length} fund${lockedIn.length === 1 ? '' : 's'} in this plan have a lock-in and cannot be redeemed early: ${names}.`,
      );
    }
  }

  return {
    totalAmount: input.totalAmount,
    allocatedAmount,
    unallocatedAmount: input.totalAmount - allocatedAmount,
    classes: plans,
    funds: allPlanned,
    weightedExpenseRatio: expenseCovered > 0 ? expenseWeighted / expenseCovered : null,
    worstOverlapPercent,
    warnings,
  };
};
