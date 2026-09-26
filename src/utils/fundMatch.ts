import { MutualFund } from '@/types/mutualFund';

/**
 * Matching a name off a statement to a scheme in the dataset
 * ==========================================================
 *
 * This is the weakest link in importing a portfolio, so it is built to fail
 * loudly rather than quietly mis-assign. A wrong match does not produce a
 * missing row — it produces a confident page of analysis about a fund the user
 * does not own, which is worse than importing nothing.
 *
 * Four things make exact string comparison useless here:
 *
 *  1. **Plan and option suffixes vary endlessly.** The same holding is written
 *     "HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth Option", "HDFC
 *     Mid Cap Opportunities-Direct-G", and "HDFC MID CAP OPPORTUNITIES FUND
 *     (DIRECT) GROWTH" by three different providers.
 *  2. **Spacing inside category words is arbitrary.** "Midcap", "Mid Cap" and
 *     "Mid-Cap" are the same fund.
 *  3. **Most statements are for regular plans.** This dataset holds direct plans
 *     only, so a regular-plan row can only be matched to the direct plan of the
 *     same scheme — which is a real answer, but one whose expense ratio is not
 *     what the user is paying. It is flagged, not silently equated.
 *  4. **Truncation.** Exports clip long names, so the query is often a prefix.
 *
 * The score is a Dice coefficient over meaningful tokens, with a bonus when one
 * squashed name contains the other (which is what rescues truncation and
 * "midcap"). Two guards keep it honest: a floor below which nothing is accepted,
 * and an ambiguity check that rejects a winner the runner-up nearly tied with —
 * a row reading only "Small Cap Fund" matches two hundred schemes equally well
 * and must not resolve to whichever sorted first.
 */

/**
 * Words that appear in a large share of scheme names and so carry almost no
 * distinguishing signal. Left in, they inflate every pairwise score toward each
 * other and flatten the gap the ambiguity check depends on.
 */
const STOPWORDS = new Set([
  'fund',
  'funds',
  'scheme',
  'mutual',
  'mf',
  'plan',
  'option',
  'direct',
  'regular',
  'growth',
  'idcw',
  'dividend',
  'payout',
  'reinvestment',
  'reinvest',
  'open',
  'ended',
  'oe',
  'g',
  'the',
  'of',
  'and',
]);

/**
 * Category words that providers write with and without a space. Normalised to
 * the squashed form so "mid cap" and "midcap" produce identical tokens.
 */
const SQUASH_PAIRS: Array<[RegExp, string]> = [
  [/\bmid\s+cap\b/g, 'midcap'],
  [/\bsmall\s+cap\b/g, 'smallcap'],
  [/\blarge\s+cap\b/g, 'largecap'],
  [/\bflexi\s+cap\b/g, 'flexicap'],
  [/\bmulti\s+cap\b/g, 'multicap'],
  [/\blarge\s+and\s+mid\s*cap\b/g, 'largeandmidcap'],
  [/\bblue\s+chip\b/g, 'bluechip'],
  [/\bultra\s+short\b/g, 'ultrashort'],
  [/\bshort\s+(?:term|duration)\b/g, 'shortduration'],
  [/\bmedium\s+(?:term|duration)\b/g, 'mediumduration'],
  [/\blong\s+(?:term|duration)\b/g, 'longduration'],
  [/\bfloating\s+(?:interest\s+)?rates?\b/g, 'floatingrate'],
  [/\bmoney\s+market\b/g, 'moneymarket'],
  [/\bfund\s+of\s+funds?\b/g, 'fof'],
  [/\bexchange\s+traded\s+fund\b/g, 'etf'],
  [/\btax\s+saver\b/g, 'taxsaver'],
  [/\btax\s+savings\b/g, 'taxsaver'],
  [/\bequity\s+savings\b/g, 'equitysavings'],
];

/**
 * Tokens of a scheme name, normalised for comparison.
 *
 * Numbers are kept: "Nifty 50" and "Nifty 500" are different indices, and
 * dropping digits would make them identical.
 */
export const nameTokens = (name: string): Set<string> => {
  let text = name.toLowerCase();

  for (const [pattern, replacement] of SQUASH_PAIRS) {
    text = text.replace(pattern, replacement);
  }

  const tokens = text
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token !== '' && !STOPWORDS.has(token));

  return new Set(tokens);
};

/** Every letter and digit, in order, with everything else removed. */
export const squashName = (name: string): string => {
  let text = name.toLowerCase();
  for (const [pattern, replacement] of SQUASH_PAIRS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/[^a-z0-9]/g, '');
};

/**
 * Key for an exact match: the squashed name with plan and option words removed
 * entirely, so every rendering of the same scheme collapses to one string.
 */
export const exactKey = (name: string): string =>
  [...nameTokens(name)].sort().join('');

/** Dice coefficient: twice the shared tokens over the combined size. */
const dice = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (large.has(token)) shared += 1;

  return (2 * shared) / (a.size + b.size);
};

/**
 * A regular-plan row, detected conservatively.
 *
 * A bare `\bregular\b` is wrong: "Aditya Birla Sun Life Regular Savings Fund" is
 * a scheme *name*, not a plan marker, and flagging it would tell the user their
 * direct-plan holding is a regular one. So "regular" only counts when it sits
 * next to a plan or option word, or after a delimiter where a plan marker goes.
 */
const REGULAR_PLAN_FORMS = [
  /\bregular\s*(?:plan|option|growth|idcw|dividend)\b/i,
  /[-–—(/|]\s*regular\b/i,
  /\bplan\s*[-:]?\s*regular\b/i,
];

export const looksRegularPlan = (name: string): boolean =>
  REGULAR_PLAN_FORMS.some((form) => form.test(name));

interface IndexEntry {
  fund: MutualFund;
  tokens: Set<string>;
  squashed: string;
}

export interface FundMatchIndex {
  byCode: Map<number, MutualFund>;
  byExact: Map<string, MutualFund[]>;
  entries: IndexEntry[];
}

export const buildFundMatchIndex = (universe: MutualFund[]): FundMatchIndex => {
  const byCode = new Map<number, MutualFund>();
  const byExact = new Map<string, MutualFund[]>();
  const entries: IndexEntry[] = [];

  for (const fund of universe) {
    if (Number.isFinite(fund.schemeCode)) byCode.set(fund.schemeCode, fund);

    const name = fund.schemeName ?? '';
    const tokens = nameTokens(name);
    entries.push({ fund, tokens, squashed: squashName(name) });

    const key = exactKey(name);
    if (key === '') continue;
    const bucket = byExact.get(key);
    if (bucket) bucket.push(fund);
    else byExact.set(key, [fund]);
  }

  return { byCode, byExact, entries };
};

export type MatchBasis = 'scheme-code' | 'exact-name' | 'tokens' | 'none';

export interface FundMatchResult {
  /** The accepted fund, or null when nothing cleared the bar. */
  fund: MutualFund | null;
  confidence: number;
  basis: MatchBasis;
  /**
   * Best candidate even when it was rejected, so the import report can say
   * "closest was X at 58%" instead of an unhelpful "not found".
   */
  bestGuess: MutualFund | null;
  /** Set when the winner was too close to the runner-up to trust. */
  ambiguousWith: MutualFund | null;
}

/**
 * Minimum token similarity to accept a name match.
 *
 * Chosen against the shapes real exports produce. At 0.75 a truncated or
 * differently-punctuated rendering of the right scheme still lands (the squash
 * bonus carries it), while a row naming only a category does not.
 */
export const MATCH_ACCEPT_THRESHOLD = 0.75;

/**
 * How far ahead of the runner-up the winner must be.
 *
 * Without this, "Small Cap Fund" resolves to an arbitrary small-cap scheme with
 * a respectable-looking score, and the user gets a page of analysis about a fund
 * they have never held.
 */
export const MATCH_AMBIGUITY_MARGIN = 0.04;

const NO_MATCH: FundMatchResult = {
  fund: null,
  confidence: 0,
  basis: 'none',
  bestGuess: null,
  ambiguousWith: null,
};

export interface MatchQuery {
  name: string;
  /** AMFI scheme code from the file, if it had one. Trusted over any name. */
  schemeCode?: number | null;
}

/**
 * Resolve one row to a fund.
 *
 * Scheme code first — it is an identifier rather than a description, and a file
 * that carries one has already solved this problem for us.
 */
export const matchFund = (index: FundMatchIndex, query: MatchQuery): FundMatchResult => {
  if (query.schemeCode != null && Number.isFinite(query.schemeCode)) {
    const byCode = index.byCode.get(query.schemeCode);
    if (byCode) {
      return {
        fund: byCode,
        confidence: 1,
        basis: 'scheme-code',
        bestGuess: byCode,
        ambiguousWith: null,
      };
    }
  }

  const name = (query.name ?? '').trim();
  if (name === '') return NO_MATCH;

  const key = exactKey(name);
  const exact = key === '' ? undefined : index.byExact.get(key);
  if (exact && exact.length === 1) {
    return {
      fund: exact[0],
      confidence: 1,
      basis: 'exact-name',
      bestGuess: exact[0],
      ambiguousWith: null,
    };
  }

  const tokens = nameTokens(name);
  const squashed = squashName(name);
  if (tokens.size === 0) return NO_MATCH;

  let best: { entry: IndexEntry; score: number } | null = null;
  let runnerUp: { entry: IndexEntry; score: number } | null = null;

  for (const entry of index.entries) {
    let score = dice(tokens, entry.tokens);

    /*
     * Containment bonus, for truncation and for spacing this normaliser did not
     * anticipate. Capped below 1 so a substring never outranks a genuine
     * token-for-token match, and only applied to names long enough for
     * containment to mean something — "hdfc" is inside a hundred schemes.
     */
    if (
      squashed.length >= 12 &&
      (entry.squashed.includes(squashed) || squashed.includes(entry.squashed))
    ) {
      score = Math.max(score, 0.9);
    }

    if (best == null || score > best.score) {
      runnerUp = best;
      best = { entry, score };
    } else if (runnerUp == null || score > runnerUp.score) {
      runnerUp = { entry, score };
    }
  }

  if (best == null) return NO_MATCH;

  const bestGuess = best.entry.fund;

  if (best.score < MATCH_ACCEPT_THRESHOLD) {
    return { ...NO_MATCH, confidence: best.score, bestGuess };
  }

  // A near-tie is not a match. Report the rival so the message can name it.
  if (runnerUp != null && best.score - runnerUp.score < MATCH_AMBIGUITY_MARGIN) {
    return {
      fund: null,
      confidence: best.score,
      basis: 'none',
      bestGuess,
      ambiguousWith: runnerUp.entry.fund,
    };
  }

  return {
    fund: bestGuess,
    confidence: Math.round(best.score * 100) / 100,
    basis: 'tokens',
    bestGuess,
    ambiguousWith: null,
  };
};
