import { parseCsv, toCsv, type CsvDocument } from '@/utils/csv';
import {
  looksRegularPlan,
  matchFund,
  type FundMatchIndex,
  type FundMatchResult,
} from '@/utils/fundMatch';
import {
  type MfHolding,
  type SipFrequency,
  type SipHolding,
} from '@/types/userHoldings';

/**
 * Reading a holdings or SIP export
 * ================================
 *
 * There is no standard file here. Every registrar, broker and aggregator emits a
 * different shape, so nothing about the layout can be assumed:
 *
 *  - Column *names* differ ("Current Value", "Market Value", "Valuation",
 *    "Present Value (₹)"), so headers are matched against an alias table rather
 *    than a fixed schema.
 *  - Column *order* differs, so columns are located by name, never by position.
 *  - The header is often not the first row — exports lead with a title, an
 *    account number and a blank line — so the header row is *found*, not assumed.
 *  - The figures a file provides differ. Some give cost value, some give only an
 *    average NAV, some give neither. What can be derived is derived; what cannot
 *    stays null and the analysis degrades explicitly rather than inventing it.
 *  - Files end with a "Total" row, which is data-shaped and must not become a
 *    holding.
 *
 * The output is deliberately two-part: the rows that made it, and a per-line
 * account of everything that did not. A silently short import is the failure mode
 * to avoid — a user whose largest position was dropped would read every
 * percentage on the page as covering their whole portfolio.
 */

export type ImportKind = 'mf' | 'sip';

type Column =
  | 'schemeName'
  | 'schemeCode'
  | 'folio'
  | 'units'
  | 'nav'
  | 'avgNav'
  | 'invested'
  | 'currentValue'
  | 'purchaseDate'
  | 'sipAmount'
  | 'frequency'
  | 'status'
  | 'startDate';

/**
 * Header words that appear for presentation rather than meaning. Removing them
 * lets one alias cover "Units", "No. of Units" and "Total Units", and lets
 * "Amount (₹)" and "Amount in Rs" both reduce to "amount".
 */
const HEADER_NOISE = new Set(['rs', 'inr', 'rupees', 'rupee', 'of', 'no', 'the', 'in', 'total']);

/**
 * Canonical form of a header cell.
 *
 * Parenthesised segments go first, because they are almost always units or
 * currency ("Current Value (₹)", "NAV (as on 31-Mar)") and stripping them after
 * squashing would leave their letters glued to the real word.
 */
export const normaliseHeader = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token !== '' && !HEADER_NOISE.has(token))
    .join('');

interface AliasSpec {
  column: Column;
  aliases: string[];
  /** Restricts an alias to one file kind when the same word means two things. */
  kinds?: ImportKind[];
}

/**
 * Header aliases, longest-meaning first within each column.
 *
 * Three entries are kind-specific because the bare word is genuinely ambiguous:
 * "Amount" is the invested cost in a holdings file and the instalment in a SIP
 * file, and "Date" is a purchase date in one and a start date in the other.
 * Guessing wrong would not fail — it would put an instalment size in a cost
 * column and report a nonsense return.
 */
const ALIASES: AliasSpec[] = [
  {
    column: 'schemeName',
    aliases: [
      'schemename',
      'fundname',
      'schemedescription',
      'securityname',
      'instrumentname',
      'instrument',
      'scheme',
      'fund',
      'name',
    ],
  },
  {
    column: 'schemeCode',
    aliases: ['schemecode', 'amficode', 'amfischemecode', 'amfi', 'schemeid', 'code'],
  },
  { column: 'folio', aliases: ['folionumber', 'folio', 'accountnumber'] },
  {
    column: 'units',
    aliases: ['units', 'unit', 'balanceunits', 'closingunits', 'closingbalance', 'quantity', 'qty'],
  },
  {
    column: 'avgNav',
    aliases: [
      'averagenav',
      'avgnav',
      'purchasenav',
      'buynav',
      'costnav',
      'averageprice',
      'avgprice',
      'purchaseprice',
      'buyprice',
      'averagecost',
      'avgcost',
    ],
  },
  { column: 'nav', aliases: ['currentnav', 'latestnav', 'nav', 'currentprice', 'lastprice'] },
  {
    column: 'invested',
    aliases: [
      'investedamount',
      'amountinvested',
      'investedvalue',
      'invested',
      'investment',
      'costvalue',
      'purchasevalue',
      'purchasecost',
      'principal',
      'cost',
    ],
  },
  {
    column: 'currentValue',
    aliases: [
      'currentvalue',
      'marketvalue',
      'presentvalue',
      'valuation',
      'currentamount',
      'currentamt',
      'value',
    ],
  },
  {
    column: 'invested',
    aliases: ['amount', 'amt'],
    kinds: ['mf'],
  },
  {
    column: 'purchaseDate',
    aliases: [
      'purchasedate',
      'investmentdate',
      'transactiondate',
      'buydate',
      'dateofinvestment',
      'investedon',
      'holdingsince',
      'since',
    ],
  },
  { column: 'purchaseDate', aliases: ['date'], kinds: ['mf'] },
  {
    column: 'sipAmount',
    aliases: [
      'sipamount',
      'installmentamount',
      'instalmentamount',
      'monthlyamount',
      'monthlyinvestment',
      'installment',
      'instalment',
      'amount',
      'amt',
      'sip',
    ],
    kinds: ['sip'],
  },
  { column: 'frequency', aliases: ['sipfrequency', 'frequency', 'freq'] },
  { column: 'status', aliases: ['sipstatus', 'status', 'state'] },
  {
    column: 'startDate',
    aliases: [
      'sipstartdate',
      'startdate',
      'firstinstallmentdate',
      'firstinstalmentdate',
      'sipdate',
      'startedon',
    ],
    kinds: ['sip'],
  },
  { column: 'startDate', aliases: ['date'], kinds: ['sip'] },
];

/** Which canonical column a header cell names, if any. */
const columnFor = (header: string, kind: ImportKind): Column | null => {
  const key = normaliseHeader(header);
  if (key === '') return null;

  for (const spec of ALIASES) {
    if (spec.kinds && !spec.kinds.includes(kind)) continue;
    if (spec.aliases.includes(key)) return spec.column;
  }
  return null;
};

export interface ColumnMap {
  /** Canonical column to its zero-based position in the row. */
  positions: Partial<Record<Column, number>>;
  /** Original header text per canonical column, for showing what was read. */
  headers: Partial<Record<Column, string>>;
  /** Headers that matched nothing, reported so a missed alias is visible. */
  unrecognised: string[];
  /** Headers that mapped to a column already taken by an earlier one. */
  duplicates: string[];
}

export const mapColumns = (row: string[], kind: ImportKind): ColumnMap => {
  const map: ColumnMap = { positions: {}, headers: {}, unrecognised: [], duplicates: [] };

  row.forEach((header, index) => {
    if (header === '') return;

    const column = columnFor(header, kind);
    if (column == null) {
      map.unrecognised.push(header);
      return;
    }

    // First wins. Aliases are ordered specific-to-generic, and a file with both
    // "Invested Amount" and "Amount" means the specific one.
    if (map.positions[column] != null) {
      map.duplicates.push(header);
      return;
    }

    map.positions[column] = index;
    map.headers[column] = header;
  });

  return map;
};

/** Columns that make a row worth importing at all, per kind. */
const REQUIRED: Record<ImportKind, Column[][]> = {
  // A name, plus at least one of: a value, a cost, or units to derive them from.
  mf: [['schemeName'], ['currentValue', 'invested', 'units']],
  sip: [['schemeName'], ['sipAmount']],
};

const satisfiesRequired = (map: ColumnMap, kind: ImportKind): boolean =>
  REQUIRED[kind].every((group) => group.some((column) => map.positions[column] != null));

/** How far into a file to look for the header row before giving up. */
const HEADER_SEARCH_ROWS = 25;

/**
 * A table to import from: a CSV file, or one sheet of a workbook.
 *
 * Both sources reduce to this, so the column matching, row reading and matching
 * logic below exists once rather than twice.
 */
export interface SourceTable {
  rows: string[][];
  /** Physical line (or spreadsheet row) number per entry in `rows`. */
  lineNumbers: number[];
  /** Shown in errors: a file name, or "book.xlsx › Holdings". */
  label: string;
}

export const tableFromCsv = (text: string, label: string): SourceTable => {
  const document: CsvDocument = parseCsv(text);
  return { rows: document.rows, lineNumbers: document.lineNumbers, label };
};

/** One table per worksheet, blank rows dropped but row numbers preserved. */
export const tablesFromSheets = (
  sheets: Array<{ name: string; rows: string[][] }>,
  fileLabel: string,
): SourceTable[] =>
  sheets.map((sheet) => {
    const rows: string[][] = [];
    const lineNumbers: number[] = [];

    sheet.rows.forEach((row, index) => {
      if (row.length === 0 || row.every((cell) => cell === '')) return;
      rows.push(row);
      lineNumbers.push(index + 1);
    });

    return { rows, lineNumbers, label: `${fileLabel} › ${sheet.name}` };
  });

/**
 * Locate the header row.
 *
 * Exports lead with titles, account numbers and blank lines, so the first row is
 * frequently not the header. The best candidate is the row that maps the most
 * canonical columns while satisfying the required set — a title row maps one
 * column at best, and a data row maps none, since scheme names and rupee figures
 * are not header aliases.
 */
export const findHeaderRow = (
  document: { rows: string[][] },
  kind: ImportKind,
): { index: number; map: ColumnMap } | null => {
  let best: { index: number; map: ColumnMap; matched: number } | null = null;

  const limit = Math.min(document.rows.length, HEADER_SEARCH_ROWS);

  for (let index = 0; index < limit; index++) {
    const map = mapColumns(document.rows[index], kind);
    if (!satisfiesRequired(map, kind)) continue;

    const matched = Object.keys(map.positions).length;
    if (best == null || matched > best.matched) best = { index, map, matched };
  }

  return best ? { index: best.index, map: best.map } : null;
};

/**
 * Of several tables, the one that looks most like the data we want.
 *
 * Workbooks routinely lead with a "Summary" or "Disclaimer" sheet, so taking the
 * first would import nothing. Scored on how many canonical columns the header
 * maps and then on how many data rows follow it, which picks the real table
 * without needing the sheet to be named anything in particular.
 */
export const pickBestTable = (tables: SourceTable[], kind: ImportKind): SourceTable | null => {
  let best: { table: SourceTable; score: number } | null = null;

  for (const table of tables) {
    const header = findHeaderRow(table, kind);
    if (!header) continue;

    const columns = Object.keys(header.map.positions).length;
    const dataRows = table.rows.length - header.index - 1;
    if (dataRows <= 0) continue;

    const score = columns * 1000 + Math.min(dataRows, 999);
    if (best == null || score > best.score) best = { table, score };
  }

  return best?.table ?? null;
};

/**
 * Parse a figure as written on an Indian statement.
 *
 * `Number()` is not enough. It returns NaN for "1,23,456.78" (lakh grouping),
 * for "₹5,000" and for "(1,200)" — the accounting form for a negative — and, far
 * worse, it returns 0 for an empty string, which would silently turn a missing
 * cost into a free holding and a 100% gain.
 */
export const parseAmount = (raw: string | undefined): number | null => {
  if (raw == null) return null;

  const text = raw.trim();
  if (text === '') return null;
  if (/^(n\/?a|nil|none|-{1,2}|—)$/i.test(text)) return null;

  const negative = /^\(.*\)$/.test(text);

  const cleaned = text
    .replace(/[()]/g, '')
    .replace(/[₹$]/g, '')
    // The `\b` must sit against the letters, not after the optional dot: with it
    // trailing, "Rs. 2,500" leaves the dot behind and parses as 0.25 rather than
    // failing, which is the worst kind of wrong.
    .replace(/\b(?:rs|inr)\b\.?/gi, '')
    // "5,000/-" is ordinary Indian notation for a whole-rupee amount.
    .replace(/\/-\s*$/, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');

  if (!/^[+-]?\d*\.?\d+$/.test(cleaned)) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  return negative ? -Math.abs(parsed) : parsed;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Statements predating this are a parse error, not a holding. */
const EARLIEST_PLAUSIBLE_YEAR = 1960;

export interface ParsedDate {
  /** ISO `YYYY-MM-DD`, or null when unreadable. */
  iso: string | null;
  /**
   * True when day-first had to be assumed because both leading components were
   * 12 or less. Surfaced as a warning rather than buried, since a misread date
   * moves a holding across the long-term capital gains boundary.
   */
  assumedDayFirst: boolean;
}

const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const isRealDate = (year: number, month: number, day: number, now: Date): boolean => {
  if (year < EARLIEST_PLAUSIBLE_YEAR || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;

  // A purchase or start date in the future is a misread field, not a holding.
  return date.getTime() <= now.getTime() + 24 * 60 * 60 * 1000;
};

/**
 * Read a date off a statement.
 *
 * `new Date(string)` is deliberately not used for the numeric forms: it reads
 * "03/04/2024" as 3 April in some engines and 4 March in others, and the whole
 * capital-gains calculation turns on which. Day-first is assumed where the
 * components allow both, matching Indian convention, and the assumption is
 * reported.
 */
export const parseStatementDate = (
  raw: string | undefined,
  now: Date = new Date(),
): ParsedDate => {
  const miss: ParsedDate = { iso: null, assumedDayFirst: false };
  if (raw == null) return miss;

  const text = raw.trim();
  if (text === '' || /^(n\/?a|nil|none|-{1,2}|—)$/i.test(text)) return miss;

  // ISO, and the only unambiguous numeric form.
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number);
    return isRealDate(y, m, d, now) ? { iso: iso(y, m, d), assumedDayFirst: false } : miss;
  }

  // "12-Mar-2024", "12 March 2024", "Mar 12, 2024".
  const named = /^(\d{1,2})[-\s/]*([a-z]{3,9})[-\s/,]*(\d{2,4})$/i.exec(text);
  const namedFirst = /^([a-z]{3,9})[-\s/]*(\d{1,2})[-\s/,]*(\d{2,4})$/i.exec(text);
  const namedParts = named
    ? { day: Number(named[1]), monthName: named[2], year: named[3] }
    : namedFirst
      ? { day: Number(namedFirst[2]), monthName: namedFirst[1], year: namedFirst[3] }
      : null;

  if (namedParts) {
    const month = MONTHS[namedParts.monthName.slice(0, 4).toLowerCase()] ?? MONTHS[namedParts.monthName.slice(0, 3).toLowerCase()];
    const year = expandYear(Number(namedParts.year));
    if (month != null && isRealDate(year, month, namedParts.day, now)) {
      return { iso: iso(year, month, namedParts.day), assumedDayFirst: false };
    }
    return miss;
  }

  const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (!numeric) return miss;

  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  const year = expandYear(Number(numeric[3]));

  // Only one reading is possible when a component exceeds 12.
  if (first > 12 && second <= 12) {
    return isRealDate(year, second, first, now)
      ? { iso: iso(year, second, first), assumedDayFirst: false }
      : miss;
  }
  if (second > 12 && first <= 12) {
    return isRealDate(year, first, second, now)
      ? { iso: iso(year, first, second), assumedDayFirst: false }
      : miss;
  }

  // Genuinely ambiguous: take day-first and say so.
  if (isRealDate(year, second, first, now)) {
    return { iso: iso(year, second, first), assumedDayFirst: true };
  }
  return miss;
};

/** Two-digit years: '99 is 1999, '24 is 2024. */
const expandYear = (year: number): number => {
  if (year >= 100) return year;
  return year <= 70 ? 2000 + year : 1900 + year;
};

const FREQUENCY_FORMS: Array<[RegExp, SipFrequency]> = [
  [/fortnight|bi[-\s]?week|every\s*2\s*week/i, 'fortnightly'],
  [/week/i, 'weekly'],
  [/month|^m$|monthly/i, 'monthly'],
  [/quarter|^q$/i, 'quarterly'],
  [/year|annual|^y$/i, 'yearly'],
];

export const parseFrequency = (raw: string | undefined): SipFrequency => {
  const text = (raw ?? '').trim();
  if (text === '') return 'unknown';

  for (const [pattern, frequency] of FREQUENCY_FORMS) {
    if (pattern.test(text)) return frequency;
  }
  return 'unknown';
};

const INACTIVE_FORMS = /paus|stop|cancel|clos|ceas|inactive|expir|complet|discontinu|terminat/i;

/**
 * Read a SIP status.
 *
 * Absent or unrecognised means active. A file with no status column at all is
 * far more common than an unmarked stopped SIP, and defaulting to inactive would
 * quietly report a running commitment as zero.
 */
export const parseActive = (raw: string | undefined): boolean => {
  const text = (raw ?? '').trim();
  if (text === '') return true;
  return !INACTIVE_FORMS.test(text);
};

/** Footer rows that repeat the table's own arithmetic. */
const TOTAL_ROW = /^(grand\s+)?(total|sub[-\s]?total|net\s+total|summary)\b/i;

export type SkipReason =
  | 'no-scheme-name'
  | 'total-row'
  | 'no-figures'
  | 'unmatched-scheme'
  | 'ambiguous-scheme';

export interface SkippedRow {
  /** Line number in the original file. */
  line: number;
  name: string;
  reason: SkipReason;
  /** Detail worth showing, such as the closest match and its score. */
  detail: string;
  /**
   * Money on the skipped row, when it was readable. Needed so the page can say
   * how much of the portfolio the analysis does not cover.
   */
  amount: number | null;
}

export interface ImportReport<T> {
  kind: ImportKind;
  rows: T[];
  skipped: SkippedRow[];
  /** Canonical column to the header text it was read from. */
  recognisedColumns: Partial<Record<Column, string>>;
  unrecognisedColumns: string[];
  /** Non-fatal observations: assumptions made, columns missing, plans mismatched. */
  warnings: string[];
  /** Set when nothing could be read at all; every other field is then empty. */
  error: string | null;
}

const emptyReport = <T>(kind: ImportKind, error: string): ImportReport<T> => ({
  kind,
  rows: [],
  skipped: [],
  recognisedColumns: {},
  unrecognisedColumns: [],
  warnings: [],
  error,
});

/** Shared preamble: find the header, and hand back the data rows. */
const readTable = (
  tables: SourceTable[],
  kind: ImportKind,
):
  | { map: ColumnMap; body: Array<{ cells: string[]; line: number }>; label: string }
  | { error: string } => {
  const usable = tables.filter((table) => table.rows.length > 0);
  if (usable.length === 0) return { error: 'That file is empty.' };

  const table = pickBestTable(usable, kind);
  if (!table) {
    const needed =
      kind === 'mf'
        ? 'a scheme name column plus at least one of current value, invested amount or units'
        : 'a scheme name column plus an instalment amount column';
    const where = usable.length > 1 ? ` Looked at all ${usable.length} sheets.` : '';
    return {
      error: `Could not find a header row. This needs ${needed}.${where} Column names are matched loosely, so "Scheme Name", "Fund", "Market Value" and "Current Value (₹)" all work.`,
    };
  }

  const header = findHeaderRow(table, kind)!;

  const body = table.rows
    .slice(header.index + 1)
    .map((cells, offset) => ({ cells, line: table.lineNumbers[header.index + 1 + offset] }));

  return { map: header.map, body, label: table.label };
};

const cellAt = (cells: string[], map: ColumnMap, column: Column): string | undefined => {
  const index = map.positions[column];
  return index == null ? undefined : cells[index];
};

/** Warnings that depend only on which columns the file had. */
const columnWarnings = (map: ColumnMap, kind: ImportKind): string[] => {
  const warnings: string[] = [];

  if (kind === 'mf') {
    if (map.positions.purchaseDate == null) {
      warnings.push(
        'No purchase date column, so exit load and capital gains on a switch cannot be worked out. Every verdict that depends on what selling would cost is withheld rather than guessed.',
      );
    }
    if (map.positions.invested == null && map.positions.avgNav == null) {
      warnings.push(
        'No cost column (invested amount or average NAV), so gains and returns per holding are unavailable. Ranking and overlap still work.',
      );
    }
    if (map.positions.currentValue == null && map.positions.nav == null) {
      warnings.push(
        'No current value or NAV column, so position sizes are unknown and concentration cannot be measured.',
      );
    }
  }

  if (kind === 'sip' && map.positions.frequency == null) {
    warnings.push(
      'No frequency column. Instalments are shown as-is and no annual total is computed, since assuming monthly would overstate a quarterly SIP by three times.',
    );
  }

  if (map.duplicates.length > 0) {
    warnings.push(
      `Ignored ${map.duplicates.length} duplicate column${map.duplicates.length === 1 ? '' : 's'} (${map.duplicates.join(', ')}) — the more specific header won.`,
    );
  }

  return warnings;
};

/**
 * Turn a match result into the fields every holding carries, plus the reason it
 * failed when it did.
 */
const resolveMatch = (
  name: string,
  schemeCode: number | null,
  index: FundMatchIndex,
): { ok: true; match: FundMatchResult } | { ok: false; reason: SkipReason; detail: string } => {
  const match = matchFund(index, { name, schemeCode });

  if (match.fund) return { ok: true, match };

  if (match.ambiguousWith && match.bestGuess) {
    return {
      ok: false,
      reason: 'ambiguous-scheme',
      detail: `Matches "${match.bestGuess.schemeName}" and "${match.ambiguousWith.schemeName}" about equally well, so it was not assigned to either.`,
    };
  }

  return {
    ok: false,
    reason: 'unmatched-scheme',
    detail: match.bestGuess
      ? `No confident match. Closest was "${match.bestGuess.schemeName}" at ${Math.round(match.confidence * 100)}%.`
      : 'No fund in the dataset resembles this name.',
  };
};

export const importMfTables = (
  tables: SourceTable[],
  index: FundMatchIndex,
  now: Date = new Date(),
): ImportReport<MfHolding> => {
  const table = readTable(tables, 'mf');
  if ('error' in table) return emptyReport<MfHolding>('mf', table.error);

  const { map, body, label } = table;
  const rows: MfHolding[] = [];
  const skipped: SkippedRow[] = [];
  const warnings = columnWarnings(map, 'mf');
  let ambiguousDates = 0;
  let regularPlans = 0;

  for (const { cells, line } of body) {
    const name = (cellAt(cells, map, 'schemeName') ?? '').trim();

    if (name === '') {
      skipped.push({
        line,
        name: '',
        reason: 'no-scheme-name',
        detail: 'No scheme name on this row.',
        amount: null,
      });
      continue;
    }

    if (TOTAL_ROW.test(name)) continue;

    const units = parseAmount(cellAt(cells, map, 'units'));
    const nav = parseAmount(cellAt(cells, map, 'nav'));
    const avgNav = parseAmount(cellAt(cells, map, 'avgNav'));

    // Prefer a stated figure; derive from units × NAV only when one is missing.
    const currentValue =
      parseAmount(cellAt(cells, map, 'currentValue')) ??
      (units != null && nav != null ? units * nav : null);
    const investedAmount =
      parseAmount(cellAt(cells, map, 'invested')) ??
      (units != null && avgNav != null ? units * avgNav : null);

    if (currentValue == null && investedAmount == null && units == null) {
      skipped.push({
        line,
        name,
        reason: 'no-figures',
        detail: 'No units, cost or value on this row.',
        amount: null,
      });
      continue;
    }

    const schemeCode = (() => {
      const parsed = parseAmount(cellAt(cells, map, 'schemeCode'));
      return parsed != null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    })();

    const resolved = resolveMatch(name, schemeCode, index);
    if (!resolved.ok) {
      skipped.push({
        line,
        name,
        reason: resolved.reason,
        detail: resolved.detail,
        amount: currentValue ?? investedAmount,
      });
      continue;
    }

    const date = parseStatementDate(cellAt(cells, map, 'purchaseDate'), now);
    if (date.assumedDayFirst) ambiguousDates += 1;

    const regular = looksRegularPlan(name);
    if (regular) regularPlans += 1;

    rows.push({
      id: `mf-${rows.length + 1}`,
      fundId: resolved.match.fund?.id ?? null,
      schemeCode: resolved.match.fund?.schemeCode ?? schemeCode,
      sourceName: name,
      matchConfidence: resolved.match.confidence,
      looksRegularPlan: regular,
      sourceFile: label,
      units,
      investedAmount,
      currentValue,
      purchaseDate: date.iso,
      folio: (cellAt(cells, map, 'folio') ?? '').trim() || null,
    });
  }

  if (ambiguousDates > 0) {
    warnings.push(
      `${ambiguousDates} date${ambiguousDates === 1 ? '' : 's'} could be read either day-first or month-first; day-first was assumed. Check any holding sitting near the one- or two-year capital gains boundary.`,
    );
  }
  if (regularPlans > 0) {
    warnings.push(
      `${regularPlans} row${regularPlans === 1 ? '' : 's'} name a regular plan. This dataset holds direct plans only, so those are matched to the direct plan of the same scheme — the expense ratio shown is the direct one and is lower than what you are paying.`,
    );
  }

  return {
    kind: 'mf',
    rows,
    skipped,
    recognisedColumns: map.headers,
    unrecognisedColumns: map.unrecognised,
    warnings,
    error: rows.length === 0 && skipped.length === 0 ? 'No holdings rows found below the header.' : null,
  };
};

export const importSipTables = (
  tables: SourceTable[],
  index: FundMatchIndex,
  now: Date = new Date(),
): ImportReport<SipHolding> => {
  const table = readTable(tables, 'sip');
  if ('error' in table) return emptyReport<SipHolding>('sip', table.error);

  const { map, body, label } = table;
  const rows: SipHolding[] = [];
  const skipped: SkippedRow[] = [];
  const warnings = columnWarnings(map, 'sip');
  let ambiguousDates = 0;
  let regularPlans = 0;
  let unknownFrequencies = 0;

  for (const { cells, line } of body) {
    const name = (cellAt(cells, map, 'schemeName') ?? '').trim();

    if (name === '') {
      skipped.push({
        line,
        name: '',
        reason: 'no-scheme-name',
        detail: 'No scheme name on this row.',
        amount: null,
      });
      continue;
    }

    if (TOTAL_ROW.test(name)) continue;

    const amount = parseAmount(cellAt(cells, map, 'sipAmount'));
    if (amount == null) {
      skipped.push({
        line,
        name,
        reason: 'no-figures',
        detail: 'No instalment amount on this row.',
        amount: null,
      });
      continue;
    }

    const schemeCode = (() => {
      const parsed = parseAmount(cellAt(cells, map, 'schemeCode'));
      return parsed != null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    })();

    const resolved = resolveMatch(name, schemeCode, index);
    if (!resolved.ok) {
      skipped.push({
        line,
        name,
        reason: resolved.reason,
        detail: resolved.detail,
        amount,
      });
      continue;
    }

    const date = parseStatementDate(cellAt(cells, map, 'startDate'), now);
    if (date.assumedDayFirst) ambiguousDates += 1;

    const frequency = parseFrequency(cellAt(cells, map, 'frequency'));
    if (frequency === 'unknown' && map.positions.frequency != null) unknownFrequencies += 1;

    const regular = looksRegularPlan(name);
    if (regular) regularPlans += 1;

    rows.push({
      id: `sip-${rows.length + 1}`,
      fundId: resolved.match.fund?.id ?? null,
      schemeCode: resolved.match.fund?.schemeCode ?? schemeCode,
      sourceName: name,
      matchConfidence: resolved.match.confidence,
      looksRegularPlan: regular,
      sourceFile: label,
      amount,
      frequency,
      startDate: date.iso,
      active: parseActive(cellAt(cells, map, 'status')),
    });
  }

  if (ambiguousDates > 0) {
    warnings.push(
      `${ambiguousDates} start date${ambiguousDates === 1 ? '' : 's'} could be read either day-first or month-first; day-first was assumed.`,
    );
  }
  if (unknownFrequencies > 0) {
    warnings.push(
      `${unknownFrequencies} row${unknownFrequencies === 1 ? '' : 's'} had a frequency this could not read, so those are left out of the annual commitment total.`,
    );
  }
  if (regularPlans > 0) {
    warnings.push(
      `${regularPlans} row${regularPlans === 1 ? '' : 's'} name a regular plan, matched to the direct plan of the same scheme. The expense ratio shown is the direct one.`,
    );
  }

  return {
    kind: 'sip',
    rows,
    skipped,
    recognisedColumns: map.headers,
    unrecognisedColumns: map.unrecognised,
    warnings,
    error: rows.length === 0 && skipped.length === 0 ? 'No SIP rows found below the header.' : null,
  };
};

/** CSV convenience wrappers. A CSV is one table. */
export const importMfHoldings = (
  text: string,
  index: FundMatchIndex,
  now: Date = new Date(),
  label = 'pasted data',
): ImportReport<MfHolding> =>
  importMfTables(text.trim() === '' ? [] : [tableFromCsv(text, label)], index, now);

export const importSipHoldings = (
  text: string,
  index: FundMatchIndex,
  now: Date = new Date(),
  label = 'pasted data',
): ImportReport<SipHolding> =>
  importSipTables(text.trim() === '' ? [] : [tableFromCsv(text, label)], index, now);

/* ---------------------------------------------------------------------------
 * Combining several files
 * ------------------------------------------------------------------------- */

/**
 * Clubbing files together is where double-counting gets in.
 *
 * Two failure modes, and they need opposite handling:
 *
 *  - **The same row in two files.** Someone uploads a statement twice, or two
 *    exports overlap. Every figure on the page would double. Safe to drop, since
 *    the rows are identical — nothing is lost.
 *  - **The same position, restated.** A January statement and an August one both
 *    list the same fund and folio with *different* units. Neither dropping nor
 *    summing is right: summing invents money that does not exist, and dropping
 *    silently picks a version. So the first is kept and the collision is
 *    **reported**, naming both files, for the user to resolve by removing one.
 *
 * Within a single file, repeated fund+folio rows are left alone — a
 * transaction-level statement legitimately lists one row per purchase, and each
 * has its own acquisition date and so its own tax lot.
 */
export interface MergeOutcome<T> {
  rows: T[];
  /** Identical rows that appeared in more than one file. */
  duplicatesDropped: number;
  /** Contradictions between files, which only the user can settle. */
  conflicts: Array<{
    description: string;
    keptFrom: string;
    droppedFrom: string;
  }>;
}

/** Units and rupees compared at a tolerance, since exports round differently. */
const figureKey = (value: number | null): string =>
  value == null ? '-' : value.toFixed(3);

const mergeRows = <T extends { id: string; sourceFile: string | null }>(
  rows: T[],
  idPrefix: string,
  exactKeyOf: (row: T) => string,
  identityKeyOf: (row: T) => string | null,
  describe: (row: T) => string,
): MergeOutcome<T> => {
  const kept: T[] = [];
  const seenExact = new Map<string, T>();
  const seenIdentity = new Map<string, T>();
  const conflicts: MergeOutcome<T>['conflicts'] = [];
  let duplicatesDropped = 0;

  for (const row of rows) {
    const exact = exactKeyOf(row);
    const previousExact = seenExact.get(exact);

    if (previousExact && previousExact.sourceFile !== row.sourceFile) {
      duplicatesDropped += 1;
      continue;
    }

    const identity = identityKeyOf(row);
    if (identity != null) {
      const previous = seenIdentity.get(identity);
      // Only a conflict across files; within one file it is a separate lot.
      if (previous && previous.sourceFile !== row.sourceFile) {
        conflicts.push({
          description: describe(row),
          keptFrom: previous.sourceFile ?? 'an earlier file',
          droppedFrom: row.sourceFile ?? 'this file',
        });
        continue;
      }
      if (!previous) seenIdentity.set(identity, row);
    }

    if (!previousExact) seenExact.set(exact, row);
    kept.push(row);
  }

  return {
    rows: kept.map((row, index) => ({ ...row, id: `${idPrefix}-${index + 1}` })),
    duplicatesDropped,
    conflicts,
  };
};

/**
 * Fold a newly-read batch of files into the set already loaded.
 *
 * Keyed by file name, with the new load winning, so re-picking a file you have
 * already uploaded corrects it rather than counting it twice. Order is preserved
 * — a replaced file stays where it was, so the on-screen list does not reshuffle
 * under the user.
 *
 * Pure and exported rather than inline in the upload component because it decides
 * what the analysis is computed over, which is worth a test.
 */
export const upsertFiles = <T extends { name: string }>(existing: T[], incoming: T[]): T[] => {
  const result = [...existing];

  for (const file of incoming) {
    const at = result.findIndex((current) => current.name === file.name);
    if (at >= 0) result[at] = file;
    else result.push(file);
  }

  return result;
};

export const mergeMfHoldings = (rows: MfHolding[]): MergeOutcome<MfHolding> =>
  mergeRows(
    rows,
    'mf',
    (row) =>
      [
        row.fundId ?? row.sourceName,
        row.folio ?? '',
        figureKey(row.units),
        figureKey(row.investedAmount),
        figureKey(row.currentValue),
        row.purchaseDate ?? '',
      ].join('|'),
    // A folio is what makes two rows for one fund distinguishable. Without one,
    // there is no way to tell a restatement from a second lot, so no identity is
    // claimed and both rows are kept.
    (row) => (row.folio ? `${row.fundId ?? row.sourceName}|${row.folio}` : null),
    (row) => `${row.sourceName} (folio ${row.folio})`,
  );

export const mergeSipHoldings = (rows: SipHolding[]): MergeOutcome<SipHolding> =>
  mergeRows(
    rows,
    'sip',
    (row) =>
      [
        row.fundId ?? row.sourceName,
        figureKey(row.amount),
        row.frequency,
        row.startDate ?? '',
        row.active ? '1' : '0',
      ].join('|'),
    // Same fund and same start date is one SIP restated. A different start date
    // is a genuinely separate registration and both are kept.
    (row) => (row.startDate ? `${row.fundId ?? row.sourceName}|${row.startDate}` : null),
    (row) => `${row.sourceName} (started ${row.startDate})`,
  );

/**
 * A file whose columns this importer definitely understands.
 *
 * Offered for download because the failure it prevents is expensive: a user who
 * uploads something unreadable has no way to tell whether the problem is their
 * column names, their date format or their file at all.
 */
export const templateCsv = (kind: ImportKind): string =>
  kind === 'mf'
    ? toCsv([
        ['Scheme Name', 'Folio', 'Units', 'Average NAV', 'Current NAV', 'Purchase Date'],
        ['Parag Parikh Flexi Cap Fund - Direct Plan - Growth', '12345678', '567.890', '52.1400', '78.9200', '15-04-2021'],
        ['HDFC Mid-Cap Opportunities Fund - Direct Growth', '87654321', '210.500', '95.3000', '142.7500', '02-11-2022'],
      ])
    : toCsv([
        ['Scheme Name', 'SIP Amount', 'Frequency', 'Start Date', 'Status'],
        ['Parag Parikh Flexi Cap Fund - Direct Plan - Growth', '10000', 'Monthly', '15-04-2021', 'Active'],
        ['UTI Nifty 50 Index Fund - Direct Growth', '5000', 'Monthly', '01-07-2023', 'Active'],
      ]);
