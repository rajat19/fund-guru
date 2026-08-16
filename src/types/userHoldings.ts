/**
 * What the *user* holds.
 *
 * Deliberately a separate module from `types/holdings.ts`, which is the
 * stock-level portfolio *of a fund* (what Infosys weight does a flexi-cap
 * scheme carry). Both are "holdings" in ordinary speech, and letting one name
 * cover both would be a permanent source of confusion in a file that computes
 * overlap between them. So: `holdings.ts` is what a fund owns, `userHoldings.ts`
 * is what the person owns.
 *
 * Every field that can be absent is typed `| null` rather than optional. These
 * objects round-trip through Firestore, which rejects `undefined` outright, and
 * an import from a broker CSV routinely lacks a purchase date or a cost figure —
 * so "missing" has to be representable rather than accidental.
 */

export type SipFrequency =
  | 'weekly'
  | 'fortnightly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'unknown';

/**
 * Instalments per year, for annualising a commitment.
 *
 * `unknown` maps to null rather than 12. Assuming monthly is right most of the
 * time and produces a silently wrong annual figure the rest of it, and the whole
 * point of the SIP side of this feature is the size of the money being committed.
 */
export const INSTALMENTS_PER_YEAR: Record<SipFrequency, number | null> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
  unknown: null,
};

export const SIP_FREQUENCY_LABEL: Record<SipFrequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  unknown: 'Unknown',
};

/** Shared by both holding kinds: how a row was tied back to a known scheme. */
export interface HoldingMatch {
  /** Fund id from the universe, or null when nothing matched confidently. */
  fundId: string | null;
  /** AMFI scheme code, when the file carried one. A far better key than a name. */
  schemeCode: number | null;
  /** Scheme name exactly as it appeared in the file, for showing what we read. */
  sourceName: string;
  /**
   * 0-1 confidence in the name match. 1 for a scheme-code or exact-name hit.
   * Kept on the holding so the UI can flag a shaky match after the fact.
   */
  matchConfidence: number;
  /**
   * True when the source name looked like a *regular* plan.
   *
   * The dataset covers direct plans only, so a regular-plan row is matched to
   * the direct plan of the same scheme. Every metric then shown — expense ratio
   * above all — belongs to the direct plan and understates what the user is
   * actually paying. Flagged rather than hidden.
   */
  looksRegularPlan: boolean;
}

/** A position the user already owns. */
export interface MfHolding extends HoldingMatch {
  /** Unique within a snapshot. Assigned at import; not meaningful elsewhere. */
  id: string;
  units: number | null;
  /** Rupees put in. Null when the file gave neither a cost value nor an average NAV. */
  investedAmount: number | null;
  /** Rupees the position is worth now. */
  currentValue: number | null;
  /**
   * ISO date the units were bought. Drives exit load and the capital-gains
   * clock, so its absence is the single biggest degradation to the analysis.
   */
  purchaseDate: string | null;
  /** Folio number, when present. Only used to explain duplicate rows. */
  folio: string | null;
}

/** A running instalment plan. */
export interface SipHolding extends HoldingMatch {
  id: string;
  /** Rupees per instalment. */
  amount: number | null;
  frequency: SipFrequency;
  startDate: string | null;
  /**
   * Whether the plan is still running. Files that carry no status column are
   * read as active — an inactive SIP the user did not mark is a far rarer input
   * than a file with no status column at all.
   */
  active: boolean;
}

/**
 * Everything the user has entered, as one document.
 *
 * One snapshot per user, overwritten on save. Versioned history would be a
 * different feature (and a different cost); this is "here is my portfolio, tell
 * me about it".
 */
export interface HoldingsSnapshot {
  mf: MfHolding[];
  sips: SipHolding[];
  /** ISO timestamp of the last successful save. Null while unsaved. */
  savedAt: string | null;
}

export const emptySnapshot = (): HoldingsSnapshot => ({
  mf: [],
  sips: [],
  savedAt: null,
});

const asNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const asFrequency = (value: unknown): SipFrequency =>
  typeof value === 'string' && value in INSTALMENTS_PER_YEAR
    ? (value as SipFrequency)
    : 'unknown';

const sanitiseMatch = (row: Record<string, unknown>): HoldingMatch => ({
  fundId: asStringOrNull(row.fundId),
  schemeCode: asNumberOrNull(row.schemeCode),
  sourceName: asStringOrNull(row.sourceName) ?? 'Unnamed scheme',
  matchConfidence: asNumberOrNull(row.matchConfidence) ?? 0,
  looksRegularPlan: row.looksRegularPlan === true,
});

/**
 * Rebuild a snapshot from an untrusted source (a Firestore document written by
 * an older version of this code, or by hand).
 *
 * Field-by-field rather than a type assertion: a stored document is outside our
 * control, and one `undefined` where a number was expected propagates into
 * `NaN`s across every total on the page. Anything unreadable is dropped, not
 * guessed at.
 */
export const sanitiseSnapshot = (value: unknown): HoldingsSnapshot => {
  const snapshot = emptySnapshot();
  if (typeof value !== 'object' || value === null) return snapshot;

  const raw = value as Partial<Record<keyof HoldingsSnapshot, unknown>>;

  const mfRows = Array.isArray(raw.mf) ? raw.mf : [];
  const sipRows = Array.isArray(raw.sips) ? raw.sips : [];

  snapshot.mf = mfRows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row, index) => ({
      ...sanitiseMatch(row),
      id: asStringOrNull(row.id) ?? `mf-${index + 1}`,
      units: asNumberOrNull(row.units),
      investedAmount: asNumberOrNull(row.investedAmount),
      currentValue: asNumberOrNull(row.currentValue),
      purchaseDate: asStringOrNull(row.purchaseDate),
      folio: asStringOrNull(row.folio),
    }));

  snapshot.sips = sipRows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row, index) => ({
      ...sanitiseMatch(row),
      id: asStringOrNull(row.id) ?? `sip-${index + 1}`,
      amount: asNumberOrNull(row.amount),
      frequency: asFrequency(row.frequency),
      startDate: asStringOrNull(row.startDate),
      active: row.active !== false,
    }));

  snapshot.savedAt = asStringOrNull(raw.savedAt);
  return snapshot;
};

export const isSnapshotEmpty = (snapshot: HoldingsSnapshot): boolean =>
  snapshot.mf.length === 0 && snapshot.sips.length === 0;
