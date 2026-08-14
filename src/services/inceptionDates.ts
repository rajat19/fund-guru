/**
 * Inception date enrichment
 * ========================
 *
 * Groww's `launch_date` cannot be used — see utils/trackRecord.ts for the
 * measurement showing it is an ingestion timestamp, not an inception date.
 *
 * AMFI publishes NAV history for every scheme, so the first NAV date is a real
 * inception date. Rather than fetching that per scheme (thousands of calls), we
 * pull one pre-generated snapshot that carries `scheme_code` and `first_date`
 * for ~38,000 schemes and join on the AMFI scheme code we already store.
 *
 * Measured join rate against the live Groww universe: 98.5%.
 *
 * This is enrichment, not a dependency: a failure here leaves `inceptionDate`
 * unset and the track record falls back to return-horizon inference, which is
 * the primary signal anyway.
 */

const SNAPSHOT_URL = 'https://api.tigzig.com/mf/v1/download?format=latest';

/** Column positions are resolved from the header, not assumed. */
const REQUIRED_COLUMNS = ['scheme_code', 'first_date'] as const;

export type InceptionDateMap = Map<number, string>;

/**
 * Minimal CSV row splitter.
 *
 * Adequate here and nowhere else: the two columns we read are a numeric code and
 * an ISO date, neither of which can contain a comma or a quote. Scheme names in
 * the same file certainly can, so this must not be reused for those.
 */
const splitRow = (line: string): string[] => line.split(',');

export const parseInceptionSnapshot = (csv: string): InceptionDateMap => {
  const lines = csv.split(/\r?\n/);
  const header = splitRow(lines[0] ?? '').map((h) => h.trim());

  const indexes = REQUIRED_COLUMNS.map((name) => header.indexOf(name));
  if (indexes.some((i) => i === -1)) {
    throw new Error(
      `Inception snapshot is missing expected columns. Found: ${header.slice(0, 25).join(', ')}`,
    );
  }
  const [codeIndex, dateIndex] = indexes;

  const map: InceptionDateMap = new Map();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const cells = splitRow(line);
    const code = Number.parseInt((cells[codeIndex] ?? '').trim(), 10);
    const date = (cells[dateIndex] ?? '').trim();

    if (!Number.isFinite(code)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    // Keep the earliest date seen for a code, in case of duplicate rows.
    const existing = map.get(code);
    if (existing == null || date < existing) map.set(code, date);
  }

  return map;
};

export const fetchInceptionDates = async (
  signal?: AbortSignal,
): Promise<InceptionDateMap> => {
  console.log('📅 Fetching AMFI inception dates...');

  const response = await fetch(SNAPSHOT_URL, { signal });
  if (!response.ok) {
    throw new Error(`Inception snapshot request failed: ${response.status} ${response.statusText}`);
  }

  const map = parseInceptionSnapshot(await response.text());
  console.log(`✅ Loaded inception dates for ${map.size} schemes`);
  return map;
};

/**
 * Attach inception dates to funds, reporting how many matched so a silent drop
 * in join rate (a sign the upstream format shifted) is visible in sync output.
 */
export const applyInceptionDates = <T extends { schemeCode: number; inceptionDate?: string | null }>(
  funds: T[],
  dates: InceptionDateMap,
): { funds: T[]; matched: number } => {
  let matched = 0;

  const enriched = funds.map((fund) => {
    const date = dates.get(fund.schemeCode);
    if (!date) return fund;
    matched++;
    return { ...fund, inceptionDate: date };
  });

  const rate = funds.length > 0 ? (100 * matched) / funds.length : 0;
  console.log(`📅 Matched inception dates for ${matched}/${funds.length} funds (${rate.toFixed(1)}%)`);
  if (funds.length > 0 && rate < 80) {
    console.warn('⚠️ Inception date join rate is unusually low — check the snapshot format.');
  }

  return { funds: enriched, matched };
};
