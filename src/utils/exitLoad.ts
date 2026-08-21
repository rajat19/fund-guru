import { MutualFund } from '@/types/mutualFund';

/**
 * Exit load parsing
 * =================
 *
 * The feed gives exit load as free English prose, not structured data. Across a
 * sample of live schemes there are four real shapes:
 *
 *   1. "Nil" / null                          — no load
 *   2. "Exit load of 1%, if redeemed within 15 days."
 *   3. "Exit load for units in excess of 10% of the investment, 1% will be
 *       charged for redemption within 1 year."
 *   4. "Exit load of 3% if redeemed within 1 year, 2% if redeemed after 1 year
 *       but within 2 year, 1% if redeemed after 2 year but within 3 year."
 *
 * Shape 3 is the one that matters most and is easiest to get wrong: roughly a
 * fifth of schemes use it, and the first 10-25% of units redeem *free*. Applying
 * the headline rate to the whole redemption overstates the cost by up to 10x.
 *
 * Anything that does not parse cleanly returns `kind: 'unknown'` rather than
 * defaulting to zero. Silently assuming "no load" on a fund that charges one is
 * the worst possible failure here, so an unparsed string surfaces in the UI as
 * "check the scheme document" instead.
 */

/** Days per month used to convert the slider's month value into load windows. */
const DAYS_PER_MONTH = 30.44;

export interface ExitLoadTier {
  ratePercent: number;
  /** Load applies when holding period is below this many days. */
  withinDays: number;
  /** For graded loads, the lower bound of the band. 0 for the first tier. */
  afterDays: number;
}

export type ExitLoadKind = 'none' | 'flat' | 'free-limit' | 'tiered' | 'unknown';

export interface ExitLoadPolicy {
  kind: ExitLoadKind;
  tiers: ExitLoadTier[];
  /**
   * Fraction of the investment redeemable with no load at all (0-1). Non-zero
   * only for the "units in excess of N%" form.
   */
  freeFraction: number;
  raw: string | null;
  note: string;
}

const NO_LOAD: ExitLoadPolicy = {
  kind: 'none',
  tiers: [],
  freeFraction: 0,
  raw: null,
  note: 'No exit load — redeemable at any time without a charge.',
};

const unknownPolicy = (raw: string): ExitLoadPolicy => ({
  kind: 'unknown',
  tiers: [],
  freeFraction: 0,
  raw,
  note: 'Exit load terms could not be read automatically. Check the scheme information document.',
});

/** Convert a "within N days/months/years" phrase into days. */
const toDays = (amount: number, unit: string): number | null => {
  const u = unit.toLowerCase();
  if (u.startsWith('day')) return amount;
  if (u.startsWith('month')) return amount * DAYS_PER_MONTH;
  if (u.startsWith('year') || u.startsWith('yr')) return amount * 365;
  return null;
};

/**
 * Rate paired with its own window, in one match.
 *
 * Counting percentages and durations independently does not work: the graded
 * strings carry a preamble duration ("...holding period is less than 3 years:
 * Exit load of 3% if redeemed within 1 year, ...") plus an "after N year" bound
 * per band, so a 3-rate string yields 6 durations and the counts never line up.
 *
 * The `[^%]*?` between rate and window is load-bearing — it cannot cross another
 * percentage sign, which is exactly what stops the "in excess of 10% of the
 * investment" allowance from being paired with the load's window and read as the
 * rate. Lazy matching then binds each rate to its nearest following window.
 */
const RATE_WITH_WINDOW =
  /(\d+(?:\.\d+)?)\s*%[^%]*?(?:within|less than|(?:on or )?before(?:\s+completion\s+of)?|up\s?to)\s+(\d+(?:\.\d+)?|one|two|three|six|twelve)\s*(days?|months?|years?|yrs?)/gi;

/** Scheme documents spell small numbers out ("within one year"). */
const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  six: 6,
  twelve: 12,
};

const parseCount = (token: string): number => WORD_NUMBERS[token.toLowerCase()] ?? Number(token);

interface RateWindow {
  ratePercent: number;
  withinDays: number;
}

const extractRateWindows = (text: string): RateWindow[] => {
  const out: RateWindow[] = [];
  for (const match of text.matchAll(RATE_WITH_WINDOW)) {
    const ratePercent = Number(match[1]);
    const withinDays = toDays(parseCount(match[2]), match[3]);
    if (Number.isFinite(ratePercent) && withinDays != null) {
      out.push({ ratePercent, withinDays });
    }
  }
  return out;
};

/**
 * Parse the "units in excess of N% of the investment" allowance, if present.
 * Also matches the "For units more than 25% of the investments" phrasing.
 */
const FREE_FRACTION_FORMS = [
  // "for units in excess of 10% of the investment"
  /(?:in excess of|more than)\s*(\d+(?:\.\d+)?)\s*%\s*of the investment/i,
  // "if units in excess of 15% are redeemed or switched-out"
  /units\s+in excess of\s*(\d+(?:\.\d+)?)\s*%/i,
  // "No exit load on 10% of units redeemed within 6 months. Beyond 10% ..."
  /no exit load on\s*(\d+(?:\.\d+)?)\s*%\s*of units/i,
];

const parseFreeFraction = (text: string): number => {
  for (const form of FREE_FRACTION_FORMS) {
    const match = form.exec(text);
    if (!match) continue;
    const percent = Number(match[1]);
    if (Number.isFinite(percent) && percent > 0 && percent < 100) return percent / 100;
  }
  return 0;
};

/** Load rates above this are implausible and signal a misparse. */
const MAX_PLAUSIBLE_RATE = 10;

export const parseExitLoad = (raw: string | null | undefined): ExitLoadPolicy => {
  if (raw == null) return NO_LOAD;

  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return NO_LOAD;
  if (/^(nil|na|n\/a|none|no exit load)\.?$/i.test(text)) return { ...NO_LOAD, raw };

  const freeFraction = parseFreeFraction(text);

  /*
   * Remove the allowance percentage before pairing rates with windows.
   *
   * The `[^%]` guard in RATE_WITH_WINDOW stops a rate from reaching across
   * another percentage sign, which is what protects the common
   * "in excess of 10% ... 1% will be charged within 1 year" ordering. But when
   * the allowance comes *after* the rate ("0.50% if units in excess of 15% are
   * redeemed within 90 days") that same guard blocks the real rate and leaves
   * only the 15% allowance to be misread as the rate. Stripping the allowance
   * token makes the parse order-independent.
   */
  const forPairing =
    freeFraction > 0
      ? text.replace(
          new RegExp(`${(freeFraction * 100).toString().replace('.', '\\.')}\\s*%`, 'g'),
          ' ',
        )
      : text;

  const pairs = extractRateWindows(forPairing);

  if (pairs.length === 0) return unknownPolicy(raw);
  if (pairs.some((p) => p.ratePercent <= 0 || p.ratePercent > MAX_PLAUSIBLE_RATE)) {
    return unknownPolicy(raw);
  }

  if (pairs.length === 1) {
    const { ratePercent, withinDays } = pairs[0];
    return {
      kind: freeFraction > 0 ? 'free-limit' : 'flat',
      tiers: [{ ratePercent, withinDays, afterDays: 0 }],
      freeFraction,
      raw,
      note:
        freeFraction > 0
          ? `The first ${(freeFraction * 100).toFixed(0)}% of the investment redeems free; ${ratePercent}% applies to the rest within the load window.`
          : `${ratePercent}% applies if redeemed inside the load window.`,
    };
  }

  // Graded: order the bands by window, and require the rate to fall as the
  // holding period lengthens. If it does not, this is not the pattern we think
  // it is and guessing would produce a confidently wrong number.
  const ordered = [...pairs].sort((a, b) => a.withinDays - b.withinDays);
  if (ordered.some((p, i) => i > 0 && p.withinDays === ordered[i - 1].withinDays)) {
    return unknownPolicy(raw);
  }
  if (ordered.some((p, i) => i > 0 && p.ratePercent > ordered[i - 1].ratePercent)) {
    return unknownPolicy(raw);
  }

  return {
    kind: 'tiered',
    tiers: ordered.map((p, i) => ({
      ratePercent: p.ratePercent,
      withinDays: p.withinDays,
      afterDays: i === 0 ? 0 : ordered[i - 1].withinDays,
    })),
    freeFraction,
    raw,
    note: 'Graded exit load — the rate falls the longer you hold.',
  };
};

export const exitLoadPolicyFor = (fund: MutualFund): ExitLoadPolicy =>
  parseExitLoad(fund.exitLoad);

export interface AppliedExitLoad {
  /** Rate applied, in percent. Zero when past the load window. */
  ratePercent: number;
  /** Fraction of the redemption the rate applies to (1 minus any free allowance). */
  chargeableFraction: number;
  /** True when the terms could not be parsed and the figure is not reliable. */
  uncertain: boolean;
  /** Days until the load lapses entirely, or 0 if it already has. */
  daysUntilFree: number;
  note: string;
}

/**
 * What exit load a redemption after `holdingDays` would actually attract.
 *
 * Days, not months, is the honest unit here: 408 of the 882 live schemes that
 * charge a load use a window under a month (7, 15 and 30 days dominate), so a
 * caller that only knows the holding period in whole months cannot ask this
 * question correctly. Anything holding an actual purchase date should use this
 * and not `applyExitLoad`.
 */
export const applyExitLoadForDays = (
  policy: ExitLoadPolicy,
  holdingDays: number,
): AppliedExitLoad => {
  if (policy.kind === 'none') {
    return {
      ratePercent: 0,
      chargeableFraction: 0,
      uncertain: false,
      daysUntilFree: 0,
      note: policy.note,
    };
  }

  if (policy.kind === 'unknown') {
    return {
      ratePercent: 0,
      chargeableFraction: 0,
      uncertain: true,
      daysUntilFree: 0,
      note: policy.note,
    };
  }

  const tier = policy.tiers.find(
    (t) => holdingDays >= t.afterDays && holdingDays < t.withinDays,
  );

  const longestWindow = Math.max(...policy.tiers.map((t) => t.withinDays));
  const daysUntilFree = Math.max(0, Math.ceil(longestWindow - holdingDays));

  if (!tier) {
    return {
      ratePercent: 0,
      chargeableFraction: 0,
      uncertain: false,
      daysUntilFree: 0,
      note: 'Past the exit load window — no charge on redemption.',
    };
  }

  return {
    ratePercent: tier.ratePercent,
    chargeableFraction: 1 - policy.freeFraction,
    uncertain: false,
    daysUntilFree,
    note: policy.note,
  };
};

/**
 * Month-granularity wrapper, for callers working from a slider rather than a
 * date — the redemption calculator, where the user picks "36 months".
 *
 * Lossy by construction: any holding period under a month collapses to zero
 * days, so a 20-day holding looks like a same-day one and gets charged a 15-day
 * load it has already escaped. That is acceptable when the input really is a
 * whole number of months and wrong when a real date was available, which is why
 * `applyExitLoadForDays` exists.
 */
export const applyExitLoad = (
  policy: ExitLoadPolicy,
  holdingMonths: number,
): AppliedExitLoad => applyExitLoadForDays(policy, holdingMonths * DAYS_PER_MONTH);

/** Human-readable summary of the load window, for display next to the raw text. */
export const describeExitLoad = (policy: ExitLoadPolicy): string => {
  if (policy.kind === 'none') return 'None';
  if (policy.kind === 'unknown') return 'See scheme document';

  const window = Math.max(...policy.tiers.map((t) => t.withinDays));
  const asMonths = window / DAYS_PER_MONTH;
  const asYears = asMonths / 12;

  // "365 days" is 11.99 months, so an exact-integer check on months would render
  // a one-year window as "1.0 year". Round against a tolerance instead.
  const nearInteger = (value: number) => Math.abs(value - Math.round(value)) < 0.06;

  const period =
    window < 31
      ? `${Math.round(window)} days`
      : asMonths >= 11.5
        ? `${nearInteger(asYears) ? Math.round(asYears) : asYears.toFixed(1)} year${asYears >= 1.95 ? 's' : ''}`
        : `${Math.round(asMonths)} months`;

  const topRate = Math.max(...policy.tiers.map((t) => t.ratePercent));
  const free = policy.freeFraction > 0 ? `, first ${(policy.freeFraction * 100).toFixed(0)}% free` : '';

  return `up to ${topRate}% within ${period}${free}`;
};
