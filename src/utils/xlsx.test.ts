import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { columnIndex, excelSerialToIso, isXlsxFilename, readXlsx } from '@/utils/xlsx';

/**
 * Read against a real workbook rather than a mock.
 *
 * The fixture is a genuine deflated .xlsx carrying the things that actually break
 * a reader: a preamble above the header, a decoy first sheet, shared strings with
 * rich-text runs, an XML-escaped ampersand, a sparse row missing a column, and
 * three numbers of which two are date-formatted serials and one is currency.
 */
const workbook = (): ArrayBuffer => {
  const bytes = readFileSync(resolve(__dirname, '__fixtures__/holdings.xlsx'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

describe('columnIndex', () => {
  it('maps spreadsheet column letters to zero-based positions', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('B7')).toBe(1);
    expect(columnIndex('Z1')).toBe(25);
    expect(columnIndex('AA1')).toBe(26);
    expect(columnIndex('AB12')).toBe(27);
  });
});

describe('excelSerialToIso', () => {
  it('uses the 1899-12-30 epoch', () => {
    // Excel treats 1900 as a leap year, so the epoch is two days before
    // 1900-01-01. Getting this wrong shifts every date by two days, which can
    // move a holding across a capital gains boundary.
    expect(excelSerialToIso(45397)).toBe('2024-04-15');
    expect(excelSerialToIso(44301)).toBe('2021-04-15');
  });

  it('ignores the time-of-day fraction', () => {
    expect(excelSerialToIso(45397.75)).toBe('2024-04-15');
  });

  it('rejects values that cannot be a date', () => {
    expect(excelSerialToIso(0)).toBeNull();
    expect(excelSerialToIso(-5)).toBeNull();
    expect(excelSerialToIso(9_999_999)).toBeNull();
    expect(excelSerialToIso(Number.NaN)).toBeNull();
  });
});

describe('readXlsx', () => {
  it('returns every sheet, in workbook order, with its name', async () => {
    const sheets = await readXlsx(workbook());

    expect(sheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Holdings']);
  });

  it('resolves shared strings, including rich-text runs', async () => {
    const [, holdings] = await readXlsx(workbook());

    // Stored as two <r> runs that have to be concatenated.
    expect(holdings.rows[3][0]).toBe('Parag Parikh Flexi Cap Fund - Direct Plan - Growth');
  });

  it('decodes XML entities in cell text', async () => {
    const [, holdings] = await readXlsx(workbook());

    expect(holdings.rows[4][0]).toBe('HDFC Mid-Cap Opportunities Fund & Co - Direct Growth');
  });

  it('converts date-formatted serials but leaves other numbers alone', async () => {
    const [, holdings] = await readXlsx(workbook());

    // Column E is date-styled — built-in format 14 on row 4, a custom
    // "dd-mmm-yyyy" on row 5. Both must become ISO dates.
    expect(holdings.rows[3][4]).toBe('2024-04-15');
    expect(holdings.rows[4][4]).toBe('2021-04-15');

    // Column D is currency-styled. It is a number that happens to sit in the
    // date serial range, and treating it as a date would be badly wrong.
    expect(holdings.rows[3][3]).toBe('44813.5');
    expect(holdings.rows[4][3]).toBe('30050');
  });

  it('keeps sparse cells in the right columns', async () => {
    const [, holdings] = await readXlsx(workbook());

    // Row 6 has no B (Folio) cell at all; C must not slide left into it.
    const row = holdings.rows[5];
    expect(row[0]).toBe('UTI Nifty 50 Index Fund - Direct Growth');
    expect(row[1]).toBe('');
    expect(row[2]).toBe('100');
  });

  it('preserves physical row positions when rows are skipped', async () => {
    const [, holdings] = await readXlsx(workbook());

    // The fixture jumps from row 1 to row 3, so index 1 is an empty row and the
    // header stays at index 2 — which is what lets a line number be reported.
    expect(holdings.rows[1]).toEqual([]);
    expect(holdings.rows[2][0]).toBe('Scheme Name');
  });

  it('reads inline strings', async () => {
    const [summary] = await readXlsx(workbook());
    expect(summary.rows[0][0]).toBe('Portfolio Summary');
  });

  it('rejects something that is not a zip', async () => {
    const notAZip = new TextEncoder().encode('Scheme Name,Units\nFoo,10').buffer;
    await expect(readXlsx(notAZip as ArrayBuffer)).rejects.toThrow(/zip/i);
  });
});

describe('isXlsxFilename', () => {
  it('matches only .xlsx', () => {
    expect(isXlsxFilename('holdings.xlsx')).toBe(true);
    expect(isXlsxFilename('HOLDINGS.XLSX')).toBe(true);
    expect(isXlsxFilename('holdings.xls')).toBe(false);
    expect(isXlsxFilename('holdings.csv')).toBe(false);
  });
});
