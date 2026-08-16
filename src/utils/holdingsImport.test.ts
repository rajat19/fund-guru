import { describe, expect, it } from 'vitest';
import {
  findHeaderRow,
  importMfHoldings,
  importSipHoldings,
  mapColumns,
  normaliseHeader,
  parseActive,
  parseAmount,
  parseFrequency,
  parseStatementDate,
  templateCsv,
} from '@/utils/holdingsImport';
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
