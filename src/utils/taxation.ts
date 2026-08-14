import { MutualFund } from '@/types/mutualFund';
import { applyExitLoad, exitLoadPolicyFor, type AppliedExitLoad } from '@/utils/exitLoad';

/**
 * Taxation layer
 * ==============
 *
 * Two funds with identical pre-tax returns can hand you materially different
 * money, because Indian mutual fund taxation depends on what the scheme holds
 * rather than what it is called. A gross-return ranking hides that entirely.
 *
 * How this module is built
 * ------------------------
 * The *rules* (which bucket a scheme falls into, and what the holding-period
 * thresholds are) live in code, because they follow from the scheme's asset
 * allocation and are stable.
 *
 * The *rates* live in one table, `TAX_REGIME`, which is versioned and dated.
 * Rates change with every Union Budget, so they must never be scattered through
 * the codebase. Update the table, bump `effectiveFrom`, and everything that
 * depends on it follows.
 *
 * !! IMPORTANT !!
 * The rates below reflect the post-July-2024 regime and are provided so the
 * arithmetic is inspectable, NOT as a source of truth. Verify against
 * incometax.gov.in before relying on any number this module produces. Nothing
 * here is tax advice.
 */

export type TaxBucket =
  /** Equity-oriented: >=65% domestic equity. Concessional LTCG. */
  | 'equity'
  /** Specified debt funds: <=35% equity. Slab-taxed, no LTCG concession. */
  | 'debt'
  /**
   * The 35-65% equity band. Gets a long-term rate, but only after a longer
   * holding period than equity — this is where most hybrid funds land.
   */
  | 'hybrid'
  /** Gold, silver, commodity funds — treated like the 35-65% band. */
  | 'commodity'
  /** Fund-of-funds and overseas equity: not equity-oriented for tax. */
  | 'international'
  | 'unknown';

export interface BucketRules {
  bucket: TaxBucket;
  label: string;
  /**
   * Months a unit must be held to qualify as long-term. null means the bucket
   * has no long-term concession at all — every gain is slab-taxed.
   */
  longTermAfterMonths: number | null;
  /** Flat LTCG rate in percent, or null when gains are taxed at slab. */
  longTermRatePercent: number | null;
  /**
   * Annual per-PAN exemption on long-term gains, in rupees. Applies to
   * equity-oriented gains only.
   */
  longTermExemptionRupees: number;
  /** Flat STCG rate in percent, or null when taxed at slab. */
  shortTermRatePercent: number | null;
  /** Plain-English summary for the UI. */
  note: string;
}

/**
 * Versioned rate table. Everything rate-related lives here and nowhere else.
 *
 * @see https://incometax.gov.in — verify before use.
 */
export const TAX_REGIME = {
  effectiveFrom: '2024-07-23',
  /** Shown in the UI so a stale table is visible rather than silent. */
  label: 'Post-Jul-2024 regime (verify current rates)',
  buckets: {
    equity: {
      bucket: 'equity',
      label: 'Equity-oriented',
      longTermAfterMonths: 12,
      longTermRatePercent: 12.5,
      longTermExemptionRupees: 125_000,
      shortTermRatePercent: 20,
      note: 'Flat rates, so your income slab does not change the tax. Each PAN gets its own annual long-term exemption.',
    },
    debt: {
      bucket: 'debt',
      label: 'Specified debt',
      longTermAfterMonths: null,
      longTermRatePercent: null,
      longTermExemptionRupees: 0,
      shortTermRatePercent: null,
      note: 'Always taxed at your slab rate with no indexation, however long you hold. This is the bucket where holding in a lower-slab account actually saves tax.',
    },
    hybrid: {
      bucket: 'hybrid',
      label: 'Hybrid (35-65% equity)',
      longTermAfterMonths: 24,
      longTermRatePercent: 12.5,
      longTermExemptionRupees: 0,
      shortTermRatePercent: null,
      note: 'Needs a longer holding period than equity to reach the long-term rate. Short-term gains are taxed at slab.',
    },
    commodity: {
      bucket: 'commodity',
      label: 'Gold / commodity',
      longTermAfterMonths: 24,
      longTermRatePercent: 12.5,
      longTermExemptionRupees: 0,
      shortTermRatePercent: null,
      note: 'Treated like the hybrid band. Physical gold, gold ETFs and gold funds are not all taxed alike — check the specific vehicle.',
    },
    international: {
      bucket: 'international',
      label: 'International / fund-of-funds',
      longTermAfterMonths: 24,
      longTermRatePercent: 12.5,
      longTermExemptionRupees: 0,
      shortTermRatePercent: null,
      note: 'Not equity-oriented for Indian tax even when it holds only equities. Overseas holdings may also require Schedule FA disclosure.',
    },
    unknown: {
      bucket: 'unknown',
      label: 'Unclassified',
      longTermAfterMonths: null,
      longTermRatePercent: null,
      longTermExemptionRupees: 0,
      shortTermRatePercent: null,
      note: 'Not enough allocation data to classify. Check the scheme information document.',
    },
  } satisfies Record<TaxBucket, BucketRules>,
} as const;

export const bucketRules = (bucket: TaxBucket): BucketRules => TAX_REGIME.buckets[bucket];

const INTERNATIONAL_HINTS = [
  'international',
  'global',
  'overseas',
  'us equity',
  'nasdaq',
  's&p',
  'china',
  'emerging market',
  'fund of fund',
  'feeder',
];

const COMMODITY_HINTS = ['gold', 'silver', 'commodity', 'precious metal'];

/**
 * Classify a scheme into a tax bucket.
 *
 * Allocation is the authoritative signal — the thresholds in the Act are
 * expressed in terms of equity percentage, not scheme names. Name matching is
 * only used for cases allocation cannot distinguish, notably international
 * funds, which hold 100% equity yet are not "equity-oriented" for Indian tax.
 */
export const classifyTaxBucket = (fund: MutualFund): TaxBucket => {
  const haystack = `${fund.schemeName} ${fund.subCategory} ${fund.category}`.toLowerCase();

  // Checked before allocation: an international equity fund looks like a 100%
  // equity fund by allocation but is taxed as a non-equity fund.
  if (INTERNATIONAL_HINTS.some((hint) => haystack.includes(hint))) return 'international';
  if (COMMODITY_HINTS.some((hint) => haystack.includes(hint))) return 'commodity';
  if (fund.category === 'Commodities') return 'commodity';

  const equityPercent = fund.portfolioMetrics.equityPercentage;

  if (equityPercent != null && !Number.isNaN(equityPercent)) {
    if (equityPercent >= 65) return 'equity';
    if (equityPercent > 35) return 'hybrid';
    return 'debt';
  }

  // No allocation data — fall back to the declared category. Less precise, and
  // deliberately conservative for Hybrid, which straddles two buckets.
  switch (fund.category) {
    case 'Equity':
      return 'equity';
    case 'Debt':
      return 'debt';
    case 'Hybrid':
      return 'hybrid';
    default:
      return 'unknown';
  }
};

export interface TaxProfile {
  bucket: TaxBucket;
  rules: BucketRules;
  /** True when classification came from allocation data rather than the name. */
  fromAllocation: boolean;
  equityPercentage: number | null;
  regimeLabel: string;
}

export const taxProfile = (fund: MutualFund): TaxProfile => {
  const bucket = classifyTaxBucket(fund);
  const equityPercentage = fund.portfolioMetrics.equityPercentage ?? null;

  return {
    bucket,
    rules: bucketRules(bucket),
    fromAllocation: equityPercentage != null && bucket !== 'international' && bucket !== 'commodity',
    equityPercentage,
    regimeLabel: TAX_REGIME.label,
  };
};

export interface PostTaxInput {
  /** Gross return over the holding period, in percent. */
  grossReturnPercent: number;
  holdingMonths: number;
  /**
   * Marginal slab rate in percent, needed for any bucket that is slab-taxed.
   * Without it, slab-taxed buckets cannot be computed and return null.
   */
  slabRatePercent?: number;
  /**
   * Remaining long-term exemption headroom for this PAN this year, in rupees.
   * Only bites when an absolute gain amount is supplied.
   */
  exemptionHeadroomRupees?: number;
  /** Absolute gain in rupees, required to apply the exemption. */
  gainRupees?: number;
}

export interface PostTaxResult {
  isLongTerm: boolean;
  /** Effective tax rate applied, in percent. */
  effectiveRatePercent: number;
  /** Return after tax, in percent. Null when it cannot be determined. */
  postTaxReturnPercent: number | null;
  /** Months until the holding qualifies as long-term; 0 if already there. */
  monthsToLongTerm: number;
  explanation: string;
}

/**
 * Post-tax return for a single holding.
 *
 * Returns null for `postTaxReturnPercent` rather than guessing when a
 * slab-taxed bucket is involved and no slab rate was supplied — silently
 * assuming 30% would produce confidently wrong numbers.
 */
export const postTaxReturn = (fund: MutualFund, input: PostTaxInput): PostTaxResult => {
  const { rules } = taxProfile(fund);
  const { grossReturnPercent, holdingMonths, slabRatePercent } = input;

  const threshold = rules.longTermAfterMonths;
  const isLongTerm = threshold != null && holdingMonths >= threshold;
  const monthsToLongTerm =
    threshold == null ? 0 : Math.max(0, Math.ceil(threshold - holdingMonths));

  const flatRate = isLongTerm ? rules.longTermRatePercent : rules.shortTermRatePercent;

  // Slab-taxed: needs the user's marginal rate.
  if (flatRate == null) {
    if (slabRatePercent == null) {
      return {
        isLongTerm,
        effectiveRatePercent: Number.NaN,
        postTaxReturnPercent: null,
        monthsToLongTerm,
        explanation: `${rules.label} gains here are taxed at your slab rate — supply a slab rate to compute a post-tax figure.`,
      };
    }

    return {
      isLongTerm,
      effectiveRatePercent: slabRatePercent,
      postTaxReturnPercent: grossReturnPercent * (1 - slabRatePercent / 100),
      monthsToLongTerm,
      explanation: `Taxed at your ${slabRatePercent}% slab rate (${rules.label}, ${
        isLongTerm ? 'long' : 'short'
      }-term).`,
    };
  }

  // Flat rate, optionally reduced by unused long-term exemption headroom.
  let taxablePortion = 1;
  let exemptionNote = '';

  if (
    isLongTerm &&
    rules.longTermExemptionRupees > 0 &&
    input.gainRupees != null &&
    input.gainRupees > 0
  ) {
    const headroom = Math.max(
      0,
      Math.min(input.exemptionHeadroomRupees ?? rules.longTermExemptionRupees, input.gainRupees),
    );
    taxablePortion = (input.gainRupees - headroom) / input.gainRupees;
    exemptionNote = ` ₹${headroom.toLocaleString('en-IN')} of the gain is covered by the annual exemption.`;
  }

  const effectiveRatePercent = flatRate * taxablePortion;

  return {
    isLongTerm,
    effectiveRatePercent,
    postTaxReturnPercent: grossReturnPercent * (1 - effectiveRatePercent / 100),
    monthsToLongTerm,
    explanation:
      `${isLongTerm ? 'Long' : 'Short'}-term ${rules.label} gain taxed at ${flatRate}%.` +
      exemptionNote,
  };
};

/**
 * Approximate post-tax 1Y/3Y/5Y returns for display alongside gross figures.
 *
 * This is a *single-lot, sell-at-the-end* approximation: it applies the
 * relevant rate to the whole trailing return. It is not an accounting of a real
 * SIP, where every instalment has its own holding period and its own bucket
 * eligibility date. Good enough to compare two funds; not good enough to file.
 */
export const postTaxReturnSeries = (
  fund: MutualFund,
  slabRatePercent?: number,
): { oneYear: number | null; threeYear: number | null; fiveYear: number | null } => {
  const horizons: Array<['oneYear' | 'threeYear' | 'fiveYear', number | null | undefined, number]> =
    [
      ['oneYear', fund.returns.oneYear, 12],
      ['threeYear', fund.returns.threeYear, 36],
      ['fiveYear', fund.returns.fiveYear, 60],
    ];

  const result = { oneYear: null, threeYear: null, fiveYear: null } as {
    oneYear: number | null;
    threeYear: number | null;
    fiveYear: number | null;
  };

  for (const [key, gross, months] of horizons) {
    if (gross == null || Number.isNaN(gross)) continue;
    result[key] = postTaxReturn(fund, {
      grossReturnPercent: gross,
      holdingMonths: months,
      slabRatePercent,
    }).postTaxReturnPercent;
  }

  return result;
};

/**
 * Which account a slab-taxed holding is cheapest to hold in, given the marginal
 * rates of the people involved. Returns null for buckets taxed at a flat rate,
 * where the account genuinely does not matter.
 *
 * This answers a structural question ("does the holder's slab affect the tax on
 * this bucket?") and nothing about anyone's circumstances.
 */
export const slabArbitrageApplies = (fund: MutualFund): boolean => {
  const { rules } = taxProfile(fund);
  return rules.longTermRatePercent == null || rules.shortTermRatePercent == null;
};

/* ---------------------------------------------------------------------------
 * Redemption projection
 * ------------------------------------------------------------------------- */

/**
 * Trailing CAGRs available to project with, longest horizon last.
 *
 * 6M is deliberately excluded: unlike the others it is an *absolute* period
 * return rather than an annualised one (verified against live data — a fund
 * showing 1Y 0.09% shows 3Y 8.9% and 10Y 12.0%, which are only coherent as
 * CAGRs). Mixing an absolute figure into a compounding calculation would
 * understate short-horizon projections by roughly half.
 */
const CAGR_HORIZONS: Array<{ months: number; label: string; pick: (f: MutualFund) => number | null | undefined }> = [
  { months: 12, label: '1Y', pick: (f) => f.returns.oneYear },
  { months: 36, label: '3Y', pick: (f) => f.returns.threeYear },
  { months: 60, label: '5Y', pick: (f) => f.returns.fiveYear },
  { months: 120, label: '10Y', pick: (f) => f.returns.tenYear },
];

export interface ReturnBasis {
  annualPercent: number;
  label: string;
  /** True when we had to borrow a horizon shorter than the holding period. */
  extrapolated: boolean;
}

/**
 * Pick the annualised return to project with: the shortest available horizon
 * that is at least as long as the holding period, else the longest we have.
 *
 * Using a 1Y number to project 10 years is extrapolation, and saying so matters
 * more than the number itself.
 */
export const returnBasisFor = (
  fund: MutualFund,
  holdingMonths: number,
): ReturnBasis | null => {
  const available = CAGR_HORIZONS.map((h) => ({ ...h, value: usableNumber(h.pick(fund)) })).filter(
    (h): h is typeof h & { value: number } => h.value != null,
  );

  if (available.length === 0) return null;

  const covering = available.find((h) => h.months >= holdingMonths);
  const chosen = covering ?? available[available.length - 1];

  return {
    annualPercent: chosen.value,
    label: chosen.label,
    extrapolated: chosen.months < holdingMonths,
  };
};

const usableNumber = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export interface RedemptionInput {
  amountRupees: number;
  holdingMonths: number;
  /** Marginal slab rate, needed for slab-taxed buckets. */
  slabRatePercent?: number;
  /** Remaining per-PAN long-term exemption for the year. */
  exemptionHeadroomRupees?: number;
  /** Override the projected annual return instead of using trailing CAGRs. */
  annualReturnPercentOverride?: number;
}

export interface RedemptionProjection {
  invested: number;
  holdingMonths: number;
  basis: ReturnBasis;
  grossValue: number;
  grossGain: number;
  exitLoad: AppliedExitLoad;
  exitLoadAmount: number;
  taxAmount: number | null;
  effectiveTaxRatePercent: number | null;
  isLongTerm: boolean;
  monthsToLongTerm: number;
  netValue: number | null;
  netGain: number | null;
  /** Annualised return after load and tax. */
  netCagrPercent: number | null;
  /**
   * What the expense ratio has already cost, for context only.
   *
   * NOT subtracted anywhere — TER is deducted from NAV daily, so it is already
   * inside every trailing return. This is the counterfactual: the value the
   * holding would have reached had the fund charged nothing.
   */
  terDragAmount: number | null;
  notes: string[];
}

const compound = (principal: number, annualPercent: number, months: number): number =>
  principal * Math.pow(1 + annualPercent / 100, months / 12);

/**
 * Project a redemption end to end: growth, exit load, tax, net proceeds.
 *
 * Deliberate simplifications, all surfaced in `notes` rather than hidden:
 *  - single lump sum, not a SIP where every instalment has its own clock
 *  - assumes the trailing CAGR repeats, which is an assumption, not a forecast
 *  - tax computed on the NAV-based gain; exit load deducted from proceeds
 *    separately rather than netted off the gain first
 */
export const projectRedemption = (
  fund: MutualFund,
  input: RedemptionInput,
): RedemptionProjection | null => {
  const { amountRupees, holdingMonths, slabRatePercent, exemptionHeadroomRupees } = input;

  const basis =
    input.annualReturnPercentOverride != null
      ? { annualPercent: input.annualReturnPercentOverride, label: 'custom', extrapolated: false }
      : returnBasisFor(fund, holdingMonths);

  if (!basis || amountRupees <= 0 || holdingMonths <= 0) return null;

  const notes: string[] = [];

  const grossValue = compound(amountRupees, basis.annualPercent, holdingMonths);
  const grossGain = grossValue - amountRupees;

  if (basis.extrapolated) {
    notes.push(
      `No ${holdingMonths >= 120 ? '10Y' : 'longer'} history available, so the ${basis.label} CAGR is projected forward — treat this as an illustration, not a forecast.`,
    );
  }

  // Exit load applies to the redemption value of the chargeable portion.
  const applied = applyExitLoad(exitLoadPolicyFor(fund), holdingMonths);
  const exitLoadAmount =
    grossValue * applied.chargeableFraction * (applied.ratePercent / 100);

  if (applied.uncertain) {
    notes.push('Exit load terms could not be parsed, so no load is included. Check the SID.');
  }

  // Tax on the NAV-based gain.
  const tax = postTaxReturn(fund, {
    grossReturnPercent: basis.annualPercent,
    holdingMonths,
    slabRatePercent,
    gainRupees: grossGain > 0 ? grossGain : undefined,
    exemptionHeadroomRupees,
  });

  const taxAmount =
    grossGain <= 0
      ? 0
      : Number.isNaN(tax.effectiveRatePercent)
        ? null
        : grossGain * (tax.effectiveRatePercent / 100);

  if (taxAmount === null) {
    notes.push(
      'This fund is taxed at your slab rate — set a marginal rate to see the tax and net figures.',
    );
  }

  if (grossGain <= 0) {
    notes.push('No gain projected over this period, so no capital gains tax would arise.');
  }

  const netValue = taxAmount === null ? null : grossValue - exitLoadAmount - taxAmount;
  const netGain = netValue === null ? null : netValue - amountRupees;
  const netCagrPercent =
    netValue === null || netValue <= 0
      ? null
      : (Math.pow(netValue / amountRupees, 12 / holdingMonths) - 1) * 100;

  // Counterfactual TER cost: value at (net return + TER) minus value at net return.
  const ter = usableNumber(fund.expenseRatio);
  const terDragAmount =
    ter == null ? null : compound(amountRupees, basis.annualPercent + ter, holdingMonths) - grossValue;

  if (tax.monthsToLongTerm > 0 && grossGain > 0) {
    notes.push(
      `Holding ${tax.monthsToLongTerm} more month${tax.monthsToLongTerm === 1 ? '' : 's'} would move this into the long-term bucket.`,
    );
  }

  return {
    invested: amountRupees,
    holdingMonths,
    basis,
    grossValue,
    grossGain,
    exitLoad: applied,
    exitLoadAmount,
    taxAmount,
    effectiveTaxRatePercent: Number.isNaN(tax.effectiveRatePercent)
      ? null
      : tax.effectiveRatePercent,
    isLongTerm: tax.isLongTerm,
    monthsToLongTerm: tax.monthsToLongTerm,
    netValue,
    netGain,
    netCagrPercent,
    terDragAmount,
    notes,
  };
};
