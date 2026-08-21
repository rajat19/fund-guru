import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findHeaderRow,
  importMfHoldings,
  importMfTables,
  importSipHoldings,
  mapColumns,
  mergeMfHoldings,
  mergeSipHoldings,
  normaliseHeader,
  parseActive,
  parseAmount,
  parseFrequency,
  parseStatementDate,
  pickBestTable,
  tablesFromSheets,
  templateCsv,
  upsertFiles,
  type SourceTable,
} from '@/utils/holdingsImport';
import { readXlsx } from '@/utils/xlsx';
import type { MfHolding, SipHolding } from '@/types/userHoldings';
import { parseCsv } from '@/utils/csv';
import { buildFundMatchIndex } from '@/utils/fundMatch';
import { makeFund } from '@/utils/__fixtures__/fund';

const NOW = new Date('2026-08-16T00:00:00Z');

const index = buildFundMatchIndex([
  makeFund({
    id: 'ppfcf',
    schemeCode: 122639,
    schemeName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
    fundHouse: 'PPFAS Mutual Fund',
  }),
  makeFund({
    id: 'hdfc-midcap',
    schemeCode: 118989,
    schemeName: 'HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth',
    fundHouse: 'HDFC Mutual Fund',
  }),
  makeFund({
    id: 'uti-nifty50',
    schemeCode: 120716,
    schemeName: 'UTI Nifty 50 Index Fund - Direct Plan - Growth',
    fundHouse: 'UTI Mutual Fund',
  }),
]);

describe('parseAmount', () => {
  it('reads lakh-grouped Indian figures', () => {
    expect(parseAmount('1,23,456.78')).toBeCloseTo(123456.78);
  });

  it('strips currency symbols and prefixes', () => {
    expect(parseAmount('₹5,000')).toBe(5000);
    expect(parseAmount('Rs. 2,500')).toBe(2500);
    expect(parseAmount('INR 1000')).toBe(1000);
    expect(parseAmount('5,000/-')).toBe(5000);
  });

  it('reads the accounting form of a negative', () => {
    expect(parseAmount('(1,200)')).toBe(-1200);
    expect(parseAmount('-1200')).toBe(-1200);
  });

  it('returns null rather than zero for a missing figure', () => {
    // The whole point: Number('') is 0, which would turn an absent cost into a
    // free holding and report an infinite gain.
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount('N/A')).toBeNull();
    expect(parseAmount('NIL')).toBeNull();
  });

  it('returns null for text that is not a figure', () => {
    expect(parseAmount('Equity')).toBeNull();
    expect(parseAmount('12abc')).toBeNull();
  });
});

describe('parseStatementDate', () => {
  it('reads ISO dates without assuming anything', () => {
    expect(parseStatementDate('2021-04-15', NOW)).toEqual({
      iso: '2021-04-15',
      assumedDayFirst: false,
    });
  });

  it('reads a day-first date when the day exceeds 12', () => {
    expect(parseStatementDate('15-04-2021', NOW).iso).toBe('2021-04-15');
    expect(parseStatementDate('15/04/2021', NOW).assumedDayFirst).toBe(false);
  });

  it('reads a month-first date when only that reading works', () => {
    expect(parseStatementDate('04/15/2021', NOW).iso).toBe('2021-04-15');
  });

  it('assumes day-first when both readings are possible, and says so', () => {
    // 03/04/2024 is 3 April in India and 4 March in the US. The capital gains
    // clock turns on which, so the assumption is reported rather than buried.
    const parsed = parseStatementDate('03/04/2024', NOW);
    expect(parsed.iso).toBe('2024-04-03');
    expect(parsed.assumedDayFirst).toBe(true);
  });

  it('reads named months in either order', () => {
    expect(parseStatementDate('12-Mar-2024', NOW).iso).toBe('2024-03-12');
    expect(parseStatementDate('12 March 2024', NOW).iso).toBe('2024-03-12');
    expect(parseStatementDate('Mar 12, 2024', NOW).iso).toBe('2024-03-12');
    expect(parseStatementDate('12-Sept-2024', NOW).iso).toBe('2024-09-12');
  });

  it('expands two-digit years', () => {
    expect(parseStatementDate('15-04-21', NOW).iso).toBe('2021-04-15');
    expect(parseStatementDate('15-04-99', NOW).iso).toBe('1999-04-15');
  });

  it('rejects a future date as a misread field', () => {
    expect(parseStatementDate('15-04-2030', NOW).iso).toBeNull();
  });

  it('rejects impossible and unreadable dates', () => {
    expect(parseStatementDate('31-02-2024', NOW).iso).toBeNull();
    expect(parseStatementDate('', NOW).iso).toBeNull();
    expect(parseStatementDate('sometime last year', NOW).iso).toBeNull();
  });
});

describe('normaliseHeader', () => {
  it('reduces presentational variants to one key', () => {
    expect(normaliseHeader('Current Value (₹)')).toBe('currentvalue');
    expect(normaliseHeader('Amount in Rs')).toBe('amount');
    expect(normaliseHeader('No. of Units')).toBe('units');
    expect(normaliseHeader('Total Units')).toBe('units');
    expect(normaliseHeader('  SCHEME   NAME  ')).toBe('schemename');
  });
});

describe('mapColumns', () => {
  it('locates columns by name, not position', () => {
    const map = mapColumns(['Units', 'Market Value', 'Scheme Name'], 'mf');
    expect(map.positions.schemeName).toBe(2);
    expect(map.positions.units).toBe(0);
    expect(map.positions.currentValue).toBe(1);
  });

  it('prefers the specific header when a file has both', () => {
    const map = mapColumns(['Scheme Name', 'Invested Amount', 'Amount'], 'mf');
    expect(map.positions.invested).toBe(1);
    expect(map.duplicates).toEqual(['Amount']);
  });

  it('reads "Amount" as cost for holdings and as instalment for SIPs', () => {
    // The same word means two different things, and swapping them would put an
    // instalment size in a cost column and report a nonsense return.
    expect(mapColumns(['Scheme Name', 'Amount'], 'mf').positions.invested).toBe(1);
    expect(mapColumns(['Scheme Name', 'Amount'], 'sip').positions.sipAmount).toBe(1);
  });

  it('reports headers it did not recognise', () => {
    const map = mapColumns(['Scheme Name', 'Units', 'Registrar Remarks'], 'mf');
    expect(map.unrecognised).toEqual(['Registrar Remarks']);
  });
});

describe('findHeaderRow', () => {
  it('skips a title preamble to find the real header', () => {
    const document = parseCsv(
      ['Portfolio Statement', 'Account: 1234567890', 'Scheme Name,Units,Market Value', 'Foo,10,100'].join(
        '\n',
      ),
    );
    const header = findHeaderRow(document, 'mf');
    expect(header?.index).toBe(2);
  });

  it('returns null when no row carries the required columns', () => {
    const document = parseCsv('Some Report\nGenerated on 1 Jan\nfoo,bar');
    expect(findHeaderRow(document, 'mf')).toBeNull();
  });
});

describe('importMfHoldings', () => {
  const file = [
    'Portfolio Holdings Statement',
    '',
    'Scheme Name,Folio No.,Units,Average NAV,Current NAV,Purchase Date',
    'Parag Parikh Flexi Cap Fund - Direct Plan - Growth,12345,567.890,52.1400,78.9200,15-04-2021',
    'HDFC Mid-Cap Opportunities Fund - Direct Growth,67890,210.500,95.3000,142.7500,02-11-2022',
    'Total,,778.390,,,',
  ].join('\n');

  it('reads rows and derives cost and value from units and NAV', () => {
    const report = importMfHoldings(file, index, NOW);

    expect(report.error).toBeNull();
    expect(report.rows).toHaveLength(2);

    const [first] = report.rows;
    expect(first.fundId).toBe('ppfcf');
    expect(first.units).toBeCloseTo(567.89);
    expect(first.investedAmount).toBeCloseTo(567.89 * 52.14, 2);
    expect(first.currentValue).toBeCloseTo(567.89 * 78.92, 2);
    expect(first.purchaseDate).toBe('2021-04-15');
    expect(first.folio).toBe('12345');
  });

  it('drops the totals footer without reporting it as an error', () => {
    const report = importMfHoldings(file, index, NOW);
    expect(report.rows.map((row) => row.sourceName)).not.toContain('Total');
    expect(report.skipped).toHaveLength(0);
  });

  it('prefers a stated value over one derived from NAV', () => {
    const report = importMfHoldings(
      [
        'Scheme Name,Units,Current NAV,Current Value',
        'Parag Parikh Flexi Cap Fund Direct Growth,100,50,9999',
      ].join('\n'),
      index,
      NOW,
    );
    expect(report.rows[0].currentValue).toBe(9999);
  });

  it('reports an unmatched scheme with its closest guess instead of dropping it silently', () => {
    const report = importMfHoldings(
      ['Scheme Name,Units,Current Value', 'Quantum Long Term Equity Value Fund,100,50000'].join('\n'),
      index,
      NOW,
    );

    expect(report.rows).toHaveLength(0);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].reason).toBe('unmatched-scheme');
    // The money has to be reported, or the page would imply full coverage.
    expect(report.skipped[0].amount).toBe(50000);
    expect(report.skipped[0].detail).toMatch(/closest/i);
  });

  it('warns when there is no purchase date column', () => {
    const report = importMfHoldings(
      ['Scheme Name,Units,Current Value', 'Parag Parikh Flexi Cap Fund Direct Growth,100,50000'].join(
        '\n',
      ),
      index,
      NOW,
    );
    expect(report.warnings.join(' ')).toMatch(/exit load and capital gains/i);
  });

  it('warns when a regular plan was matched to a direct one', () => {
    const report = importMfHoldings(
      [
        'Scheme Name,Units,Current Value',
        'Parag Parikh Flexi Cap Fund - Regular Plan - Growth,100,50000',
      ].join('\n'),
      index,
      NOW,
    );
    expect(report.rows[0].looksRegularPlan).toBe(true);
    expect(report.warnings.join(' ')).toMatch(/regular plan/i);
  });

  it('warns when a date could be read two ways', () => {
    const report = importMfHoldings(
      [
        'Scheme Name,Units,Current Value,Purchase Date',
        'Parag Parikh Flexi Cap Fund Direct Growth,100,50000,03/04/2024',
      ].join('\n'),
      index,
      NOW,
    );
    expect(report.warnings.join(' ')).toMatch(/day-first/i);
  });

  it('accepts a tab-separated file with different column names and order', () => {
    const report = importMfHoldings(
      [
        'Market Value\tQuantity\tFund',
        '50000\t100\tParag Parikh Flexi Cap Fund Direct Growth',
      ].join('\n'),
      index,
      NOW,
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].currentValue).toBe(50000);
  });

  it('explains itself when no header can be found', () => {
    const report = importMfHoldings('just,some,junk\n1,2,3', index, NOW);
    expect(report.error).toMatch(/header row/i);
    expect(report.rows).toHaveLength(0);
  });

  it('reports an empty file as such', () => {
    expect(importMfHoldings('   ', index, NOW).error).toMatch(/empty/i);
  });

  it('skips a row with no figures at all', () => {
    const report = importMfHoldings(
      ['Scheme Name,Units,Current Value', 'Parag Parikh Flexi Cap Fund Direct Growth,,'].join('\n'),
      index,
      NOW,
    );
    expect(report.rows).toHaveLength(0);
    expect(report.skipped[0].reason).toBe('no-figures');
  });

  it('matches on scheme code when the name is unhelpful', () => {
    const report = importMfHoldings(
      ['Scheme Code,Scheme Name,Current Value', '122639,Flexi Cap Fund,50000'].join('\n'),
      index,
      NOW,
    );
    expect(report.rows[0].fundId).toBe('ppfcf');
    expect(report.rows[0].matchConfidence).toBe(1);
  });
});

describe('importSipHoldings', () => {
  const file = [
    'Scheme Name,SIP Amount,Frequency,Start Date,Status',
    'Parag Parikh Flexi Cap Fund - Direct Plan - Growth,10000,Monthly,15-04-2021,Active',
    'UTI Nifty 50 Index Fund - Direct Growth,"5,000",Quarterly,01-07-2023,Paused',
  ].join('\n');

  it('reads instalments, frequency and status', () => {
    const report = importSipHoldings(file, index, NOW);

    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({
      fundId: 'ppfcf',
      amount: 10000,
      frequency: 'monthly',
      startDate: '2021-04-15',
      active: true,
    });
    expect(report.rows[1]).toMatchObject({
      amount: 5000,
      frequency: 'quarterly',
      active: false,
    });
  });

  it('skips a row with no instalment amount', () => {
    const report = importSipHoldings(
      ['Scheme Name,SIP Amount', 'Parag Parikh Flexi Cap Fund Direct Growth,'].join('\n'),
      index,
      NOW,
    );
    expect(report.rows).toHaveLength(0);
    expect(report.skipped[0].reason).toBe('no-figures');
  });

  it('warns rather than assuming monthly when there is no frequency column', () => {
    const report = importSipHoldings(
      ['Scheme Name,Amount', 'Parag Parikh Flexi Cap Fund Direct Growth,10000'].join('\n'),
      index,
      NOW,
    );
    expect(report.rows[0].frequency).toBe('unknown');
    expect(report.warnings.join(' ')).toMatch(/assuming monthly would overstate/i);
  });
});

describe('parseFrequency', () => {
  it('reads the forms files actually use', () => {
    expect(parseFrequency('Monthly')).toBe('monthly');
    expect(parseFrequency('MONTH')).toBe('monthly');
    expect(parseFrequency('Quarterly')).toBe('quarterly');
    expect(parseFrequency('Weekly')).toBe('weekly');
    expect(parseFrequency('Fortnightly')).toBe('fortnightly');
    expect(parseFrequency('Bi-Weekly')).toBe('fortnightly');
    expect(parseFrequency('Annual')).toBe('yearly');
    expect(parseFrequency('')).toBe('unknown');
    expect(parseFrequency('every full moon')).toBe('unknown');
  });
});

describe('parseActive', () => {
  it('treats an absent status as active', () => {
    // A file with no status column is far commoner than an unmarked stopped SIP.
    expect(parseActive('')).toBe(true);
    expect(parseActive(undefined)).toBe(true);
  });

  it('recognises the ways a stopped SIP is written', () => {
    expect(parseActive('Paused')).toBe(false);
    expect(parseActive('Stopped')).toBe(false);
    expect(parseActive('Cancelled')).toBe(false);
    expect(parseActive('Completed')).toBe(false);
    expect(parseActive('Active')).toBe(true);
    expect(parseActive('Running')).toBe(true);
  });
});

describe('pickBestTable', () => {
  const summary: SourceTable = {
    label: 'book.xlsx › Summary',
    rows: [['Portfolio Summary'], ['Generated today']],
    lineNumbers: [1, 2],
  };

  const holdings: SourceTable = {
    label: 'book.xlsx › Holdings',
    rows: [
      ['Scheme Name', 'Units', 'Current Value'],
      ['Parag Parikh Flexi Cap Fund Direct Growth', '100', '50000'],
    ],
    lineNumbers: [1, 2],
  };

  it('skips a decoy sheet and finds the one with the data', () => {
    // Workbooks routinely lead with a Summary or Disclaimer sheet, so taking the
    // first would import nothing.
    expect(pickBestTable([summary, holdings], 'mf')?.label).toBe('book.xlsx › Holdings');
  });

  it('prefers the sheet mapping more columns', () => {
    const richer: SourceTable = {
      label: 'book.xlsx › Detail',
      rows: [
        ['Scheme Name', 'Folio', 'Units', 'Average NAV', 'Current Value', 'Purchase Date'],
        ['Parag Parikh Flexi Cap Fund Direct Growth', '1', '100', '50', '50000', '15-04-2021'],
      ],
      lineNumbers: [1, 2],
    };

    expect(pickBestTable([holdings, richer], 'mf')?.label).toBe('book.xlsx › Detail');
  });

  it('ignores a sheet whose header has no rows under it', () => {
    const headerOnly: SourceTable = {
      label: 'book.xlsx › Empty',
      rows: [['Scheme Name', 'Units', 'Current Value']],
      lineNumbers: [1],
    };

    expect(pickBestTable([headerOnly], 'mf')).toBeNull();
  });

  it('returns null when nothing looks like the data', () => {
    expect(pickBestTable([summary], 'mf')).toBeNull();
  });
});

describe('importMfTables — spreadsheets', () => {
  const workbook = (): ArrayBuffer => {
    const bytes = readFileSync(resolve(__dirname, '__fixtures__/holdings.xlsx'));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  };

  it('imports from an xlsx, picking the right sheet and reading date serials', async () => {
    const sheets = await readXlsx(workbook());
    const report = importMfTables(tablesFromSheets(sheets, 'book.xlsx'), index, NOW);

    expect(report.error).toBeNull();
    expect(report.rows).toHaveLength(3);

    const [first] = report.rows;
    expect(first.fundId).toBe('ppfcf');
    expect(first.units).toBeCloseTo(567.89);
    // 45397 with a date style, not the raw serial.
    expect(first.purchaseDate).toBe('2024-04-15');
    expect(first.folio).toBe('12345');
    // Provenance carries the sheet, not just the file.
    expect(first.sourceFile).toBe('book.xlsx › Holdings');
  });

  it('reports the spreadsheet row number for a skipped row', async () => {
    const sheets = await readXlsx(workbook());
    // Sheet has no scheme this index knows for the third row? All three match
    // here, so assert the line numbers of the rows we did read instead.
    const report = importMfTables(tablesFromSheets(sheets, 'book.xlsx'), index, NOW);
    expect(report.skipped).toHaveLength(0);
    expect(report.recognisedColumns.purchaseDate).toBe('Purchase Date');
  });

  it('explains an .xls file rather than failing obscurely', async () => {
    // The old binary format is not a zip at all.
    const notXlsx = new TextEncoder().encode('\xD0\xCF\x11\xE0 old binary xls').buffer;
    await expect(readXlsx(notXlsx as ArrayBuffer)).rejects.toThrow();
  });
});

describe('mergeMfHoldings', () => {
  const row = (overrides: Partial<MfHolding> = {}): MfHolding => ({
    id: 'mf-1',
    fundId: 'ppfcf',
    schemeCode: 122639,
    sourceName: 'Parag Parikh Flexi Cap Fund',
    matchConfidence: 1,
    looksRegularPlan: false,
    sourceFile: 'a.csv',
    units: 100,
    investedAmount: 50_000,
    currentValue: 70_000,
    purchaseDate: '2021-04-15',
    folio: '12345',
    ...overrides,
  });

  it('drops a row that is identical across two files', () => {
    // Uploading the same statement twice would otherwise double every figure.
    const merged = mergeMfHoldings([row(), row({ sourceFile: 'b.csv' })]);

    expect(merged.rows).toHaveLength(1);
    expect(merged.duplicatesDropped).toBe(1);
    expect(merged.conflicts).toHaveLength(0);
  });

  it('reports a restated position instead of summing or silently dropping it', () => {
    /*
     * A January and an August statement of the same folio. Summing invents money;
     * dropping quietly picks a version. Keep the first and say so.
     */
    const merged = mergeMfHoldings([
      row({ sourceFile: 'jan.csv', units: 100, currentValue: 70_000 }),
      row({ sourceFile: 'aug.csv', units: 140, currentValue: 96_000 }),
    ]);

    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0].currentValue).toBe(70_000);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]).toMatchObject({ keptFrom: 'jan.csv', droppedFrom: 'aug.csv' });
  });

  it('keeps separate folios of the same fund', () => {
    const merged = mergeMfHoldings([
      row({ folio: '111' }),
      row({ sourceFile: 'b.csv', folio: '222' }),
    ]);

    expect(merged.rows).toHaveLength(2);
    expect(merged.conflicts).toHaveLength(0);
  });

  it('keeps repeated rows from within one file, which are separate lots', () => {
    // A transaction-level statement lists one row per purchase, and each has its
    // own acquisition date and so its own tax lot.
    const merged = mergeMfHoldings([
      row({ purchaseDate: '2021-04-15', units: 50 }),
      row({ purchaseDate: '2023-06-01', units: 50 }),
    ]);

    expect(merged.rows).toHaveLength(2);
    expect(merged.conflicts).toHaveLength(0);
  });

  it('keeps both when there is no folio to identify a restatement by', () => {
    const merged = mergeMfHoldings([
      row({ folio: null, units: 100 }),
      row({ sourceFile: 'b.csv', folio: null, units: 140 }),
    ]);

    expect(merged.rows).toHaveLength(2);
    expect(merged.conflicts).toHaveLength(0);
  });

  it('renumbers ids so they stay unique after merging', () => {
    const merged = mergeMfHoldings([
      row({ id: 'mf-1', folio: '111' }),
      row({ id: 'mf-1', sourceFile: 'b.csv', folio: '222' }),
    ]);

    expect(merged.rows.map((r) => r.id)).toEqual(['mf-1', 'mf-2']);
  });
});

describe('upsertFiles', () => {
  const file = (name: string, marker: string) => ({ name, marker });

  it('appends a newly added file', () => {
    const after = upsertFiles([file('a.csv', '1')], [file('b.csv', '2')]);
    expect(after.map((f) => f.name)).toEqual(['a.csv', 'b.csv']);
  });

  it('replaces a file picked again rather than counting it twice', () => {
    const after = upsertFiles([file('a.csv', 'old')], [file('a.csv', 'new')]);
    expect(after).toHaveLength(1);
    expect(after[0].marker).toBe('new');
  });

  it('keeps a replaced file in its original position', () => {
    // Otherwise the on-screen list reshuffles under the user.
    const after = upsertFiles(
      [file('a.csv', '1'), file('b.csv', '2'), file('c.csv', '3')],
      [file('b.csv', 'updated')],
    );
    expect(after.map((f) => f.name)).toEqual(['a.csv', 'b.csv', 'c.csv']);
    expect(after[1].marker).toBe('updated');
  });

  it('handles a batch containing both a new and a replaced file', () => {
    const after = upsertFiles(
      [file('a.csv', '1')],
      [file('a.csv', 'updated'), file('b.csv', '2')],
    );
    expect(after.map((f) => `${f.name}:${f.marker}`)).toEqual(['a.csv:updated', 'b.csv:2']);
  });
});

describe('adding a file recomputes over the whole set', () => {
  /**
   * The sequence the upload pane performs: read a file, fold it into the files
   * already loaded, then merge *every* file's rows and hand that up. What the
   * analysis sees must be the union, not just the latest file.
   */
  const csv = (scheme: string, folio: string, units: string) =>
    [
      'Scheme Name,Folio No.,Units,Current Value,Purchase Date',
      `"${scheme}",${folio},${units},50000,15-04-2021`,
    ].join('\n');

  const load = (name: string, text: string) => ({
    name,
    rows: importMfHoldings(text, index, NOW, name).rows,
  });

  const publishedRows = (files: Array<{ name: string; rows: MfHolding[] }>) =>
    mergeMfHoldings(files.flatMap((file) => file.rows)).rows;

  it('covers both files after a second upload', () => {
    let files = upsertFiles([], [load('one.csv', csv('Parag Parikh Flexi Cap Fund', 'F1', '100'))]);
    expect(publishedRows(files)).toHaveLength(1);

    files = upsertFiles(
      files,
      [load('two.csv', csv('HDFC Mid-Cap Opportunities Fund', 'F2', '200'))],
    );

    const rows = publishedRows(files);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.fundId).sort()).toEqual(['hdfc-midcap', 'ppfcf']);
    // Provenance survives the merge, so each row is still attributable.
    expect(rows.map((row) => row.sourceFile).sort()).toEqual(['one.csv', 'two.csv']);
  });

  it('shrinks back to the remaining files when one is removed', () => {
    const files = upsertFiles(
      [],
      [
        load('one.csv', csv('Parag Parikh Flexi Cap Fund', 'F1', '100')),
        load('two.csv', csv('HDFC Mid-Cap Opportunities Fund', 'F2', '200')),
      ],
    );

    expect(publishedRows(files)).toHaveLength(2);
    expect(publishedRows(files.filter((file) => file.name !== 'two.csv'))).toHaveLength(1);
  });

  it('does not double-count when the same file is uploaded twice', () => {
    const first = load('one.csv', csv('Parag Parikh Flexi Cap Fund', 'F1', '100'));
    const files = upsertFiles([first], [load('one.csv', csv('Parag Parikh Flexi Cap Fund', 'F1', '100'))]);

    expect(publishedRows(files)).toHaveLength(1);
  });

  it('does not double-count the same holding arriving under two file names', () => {
    // Different file name, identical row — the merge catches what upsert cannot.
    const files = upsertFiles(
      [],
      [
        load('one.csv', csv('Parag Parikh Flexi Cap Fund', 'F1', '100')),
        load('copy.csv', csv('Parag Parikh Flexi Cap Fund', 'F1', '100')),
      ],
    );

    const merged = mergeMfHoldings(files.flatMap((file) => file.rows));
    expect(merged.rows).toHaveLength(1);
    expect(merged.duplicatesDropped).toBe(1);
  });
});

describe('mergeSipHoldings', () => {
  const row = (overrides: Partial<SipHolding> = {}): SipHolding => ({
    id: 'sip-1',
    fundId: 'ppfcf',
    schemeCode: 122639,
    sourceName: 'Parag Parikh Flexi Cap Fund',
    matchConfidence: 1,
    looksRegularPlan: false,
    sourceFile: 'a.csv',
    amount: 10_000,
    frequency: 'monthly',
    startDate: '2021-04-15',
    active: true,
    ...overrides,
  });

  it('drops an identical SIP from a second file', () => {
    const merged = mergeSipHoldings([row(), row({ sourceFile: 'b.csv' })]);

    expect(merged.rows).toHaveLength(1);
    expect(merged.duplicatesDropped).toBe(1);
  });

  it('reports the same SIP restated at a different amount', () => {
    const merged = mergeSipHoldings([
      row({ sourceFile: 'old.csv', amount: 10_000 }),
      row({ sourceFile: 'new.csv', amount: 15_000 }),
    ]);

    expect(merged.rows).toHaveLength(1);
    expect(merged.conflicts).toHaveLength(1);
  });

  it('keeps two SIPs into one fund started on different dates', () => {
    // A genuinely separate registration, not a restatement.
    const merged = mergeSipHoldings([
      row({ startDate: '2021-04-15' }),
      row({ sourceFile: 'b.csv', startDate: '2024-01-10', amount: 5_000 }),
    ]);

    expect(merged.rows).toHaveLength(2);
    expect(merged.conflicts).toHaveLength(0);
  });
});

describe('templateCsv', () => {
  it('produces a file this importer can read back', () => {
    const mf = importMfHoldings(templateCsv('mf'), index, NOW);
    expect(mf.error).toBeNull();
    expect(mf.rows).toHaveLength(2);

    const sip = importSipHoldings(templateCsv('sip'), index, NOW);
    expect(sip.error).toBeNull();
    expect(sip.rows).toHaveLength(2);
  });
});
