import { MutualFund } from '@/types/mutualFund';

/**
 * Shortening scheme names for narrow columns.
 *
 * Truncating by word count does not work. Scheme names put the AMC first, so
 * taking the first two words yields "Motilal Oswal" for every Motilal fund —
 * two different schemes become indistinguishable in a comparison table — and
 * "Bank of India Small Cap Fund" becomes the meaningless fragment "Bank of".
 *
 * The distinguishing part of a scheme name is the middle: the AMC prefix is
 * redundant when the fund house is shown separately, and the plan/option suffix
 * ("Direct Growth", "Regular IDCW Payout") is identical across the universe
 * since only direct plans are fetched.
 */

/** Plan and option words that carry no information in a direct-plans-only app. */
const PLAN_NOISE =
  /\b(direct|regular|plan|growth|idcw|dividend|payout|reinvest(?:ment)?|option)\b/gi;

/** Corporate suffixes on the fund house name. */
const HOUSE_SUFFIX = /\s*(mutual fund|asset management(?: company)?(?: limited| ltd\.?)?|amc|india)\s*$/i;

/**
 * Fund house without its corporate suffix — "Motilal Oswal Mutual Fund"
 * becomes "Motilal Oswal".
 *
 * `india` is only stripped when it trails the whole string, so "Bank of India
 * Mutual Fund" keeps "Bank of India" (the suffix regex removes "Mutual Fund"
 * first, and a second pass would be needed to lose "India" — which we do not do).
 */
export const fundHouseShortName = (fundHouse: string | null | undefined): string =>
  (fundHouse ?? '').replace(HOUSE_SUFFIX, '').trim();

/**
 * The part of the scheme name that actually distinguishes it from its siblings.
 *
 * Falls back to the full scheme name whenever stripping would leave nothing —
 * better a long label than an empty one.
 */
/** Words that must never start a shortened name — a sign of a bad split. */
const CONNECTIVE = /^(of|and|&|the|for|in)\b/i;

/**
 * Strip the fund house prefix, matching as many of its leading words as the
 * scheme name actually starts with.
 *
 * An exact match is too strict: the house is "Kotak Mahindra Mutual Fund" while
 * its schemes are named "Kotak ...", so requiring the whole thing would strip
 * nothing. Longest-first ensures "Bank of India Small Cap Fund" loses all three
 * words rather than just "Bank" and leaving "of India Small Cap Fund".
 */
const stripHousePrefix = (name: string, house: string): string => {
  if (!house) return name;

  const words = house.split(/\s+/).filter(Boolean);

  for (let take = words.length; take > 0; take--) {
    const prefix = words.slice(0, take).join(' ');
    if (!name.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    const rest = name.slice(prefix.length).trim();
    // Reject a split that leaves a dangling connective, and never strip
    // everything — both mean we matched the wrong boundary.
    if (rest && !CONNECTIVE.test(rest)) return rest;
  }

  return name;
};

export const schemeShortName = (fund: MutualFund): string => {
  const full = (fund.schemeName ?? '').trim();
  if (!full) return fund.fundName ?? '';

  const rest = stripHousePrefix(full, fundHouseShortName(fund.fundHouse))
    .replace(/[-–—]/g, ' ')
    .replace(PLAN_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return rest || full;
};

/** Two-part label for table headers and tiles: house on one line, scheme on the next. */
export interface SchemeLabel {
  house: string;
  scheme: string;
  /** Full untruncated name, for a title attribute. */
  full: string;
}

export const schemeLabel = (fund: MutualFund): SchemeLabel => ({
  house: fundHouseShortName(fund.fundHouse),
  scheme: schemeShortName(fund),
  full: fund.schemeName ?? '',
});
