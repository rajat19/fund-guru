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

export interface BuilderInput {
  /** Rupees to deploy. */
  totalAmount: number;
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

const minInvestmentOf = (fund: MutualFund): number => toNumber(fund.minInvestment) ?? 0;

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
const allocateWithinClass = (
  funds: ScoredFund[],
  amount: number,
  weighting: 'equal' | 'score',
  roundTo: number,
  onDrop: (fund: ScoredFund, share: number) => void,
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
      const min = minInvestmentOf(fund);
      return min > 0 && share < min;
    });

    if (tooSmall.length === 0) return split;

    // Drop the worst-scoring offender only, so one tiny share does not evict a
    // whole class at once.
    const drop = tooSmall.reduce((worst, f) => (f.score < worst.score ? f : worst));
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
  const roundTo = Math.max(1, input.roundTo ?? 100);
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

  // Screen once: risk band, track record, and enough data to rank on.
  const eligible = candidates.filter((fund) => {
    if (!withinRisk(fund, input.maxRisk)) return false;
    if (trackRecordOf(fund).years < minYears) return false;
    return true;
  });

  if (eligible.length === 0) {
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
    const wanted = classFundCounts.get(cls) ?? 1;
    const pool = eligible.filter((fund) => classifyAssetClass(fund) === cls);

    if (pool.length === 0) {
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

    // rankFundsWithContext drops funds without enough data to rank, which is
    // right for a plan but must not be invisible — otherwise a class silently
    // comes back short with no explanation.
    const ranked = rankFundsWithContext(pool, context);
    const excluded = pool.length - ranked.length;
    if (excluded > 0 && ranked.length < wanted) {
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: ${excluded} of ${pool.length} matching funds were skipped for having too little data to rank.`,
      );
    }

    const relaxations: string[] = [];
    const selected = selectFunds(ranked, wanted, rules, state, input.holdings, (msg) =>
      relaxations.push(msg),
    );

    if (relaxations.length > 0) {
      warnings.push(
        `${ASSET_CLASS_LABEL[cls]}: to reach ${wanted} fund${wanted === 1 ? '' : 's'} the builder ${[...new Set(relaxations)].join(' and ')}.`,
      );
    }

    const dropped: string[] = [];
    const amounts = allocateWithinClass(selected, targetAmount, weighting, roundTo, (fund, share) =>
      dropped.push(
        `${fund.schemeName} (share ₹${share.toLocaleString('en-IN')} below its ₹${minInvestmentOf(fund).toLocaleString('en-IN')} minimum)`,
      ),
    );

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
    warnings.push(
      `${lockedIn.length} fund${lockedIn.length === 1 ? '' : 's'} in this plan have a lock-in and cannot be redeemed early: ${lockedIn.map((p) => p.fund.schemeName).join('; ')}.`,
    );
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
