import { describe, expect, it } from 'vitest';
import { detectDelimiter, isBlankRow, parseCsv, toCsv } from '@/utils/csv';

describe('parseCsv', () => {
  it('reads a plain comma-separated table', () => {
    const { rows } = parseCsv('a,b\n1,2');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM off the first header', () => {
    // Excel writes this, and it silently breaks header matching otherwise.
    const { rows } = parseCsv('﻿Scheme Name,Units\nFoo,10');
    expect(rows[0][0]).toBe('Scheme Name');
  });

  it('handles CRLF and bare CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2').rows).toHaveLength(2);
    expect(parseCsv('a,b\r1,2').rows).toHaveLength(2);
  });

  it('keeps a delimiter that sits inside a quoted field', () => {
    const { rows } = parseCsv('name,units\n"Aditya Birla Equity Hybrid \'95, Direct",100');
    expect(rows[1]).toEqual(["Aditya Birla Equity Hybrid '95, Direct", '100']);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    const { rows } = parseCsv('name\n"He said ""hi"""');
    expect(rows[1]).toEqual(['He said "hi"']);
  });

  it('keeps a newline inside a quoted field on one row', () => {
    const { rows } = parseCsv('name,units\n"Line one\nLine two",5');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['Line one\nLine two', '5']);
  });

  it('drops blank rows but still reports original line numbers', () => {
    const { rows, lineNumbers } = parseCsv('title\n\nname,units\nFoo,1');
    expect(rows).toHaveLength(3);
    // 'name,units' is physically line 3 even though it is the second kept row.
    expect(lineNumbers[1]).toBe(3);
  });

  it('does not lose the final row when there is no trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n3,4').rows).toHaveLength(3);
  });

  it('treats a trailing newline as the end rather than an empty row', () => {
    expect(parseCsv('a,b\n1,2\n').rows).toHaveLength(2);
  });

  it('trims surrounding whitespace off every cell', () => {
    expect(parseCsv('a , b\n 1 , 2 ').rows[1]).toEqual(['1', '2']);
  });
});

describe('detectDelimiter', () => {
  it('picks the delimiter that yields a consistent table', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
  });

  it('is not fooled by commas inside quoted fields', () => {
    // Counting raw commas would pick ',' and produce one ragged table; only a
    // full parse knows those commas were not structural.
    const text = 'name;units\n"HDFC Mid-Cap, Direct, Growth";100\n"SBI Bluechip, Direct";50';
    expect(detectDelimiter(text)).toBe(';');
  });

  it('is not fooled by commas inside Indian rupee groupings', () => {
    const text = 'name\tvalue\nFoo\t"1,23,456.78"\nBar\t"2,00,000"';
    expect(detectDelimiter(text)).toBe('\t');
  });

  it('falls back to a comma when nothing splits into columns', () => {
    expect(detectDelimiter('single-column\nvalue')).toBe(',');
  });
});

describe('isBlankRow', () => {
  it('is true only when every cell is empty', () => {
    expect(isBlankRow(['', '', ''])).toBe(true);
    expect(isBlankRow(['', 'x'])).toBe(false);
  });
});

describe('toCsv', () => {
  it('quotes only the cells that need it', () => {
    expect(toCsv([['a', 'b,c', 'd"e']])).toBe('a,"b,c","d""e"');
  });

  it('round-trips through parseCsv', () => {
    const rows = [
      ['Scheme Name', 'Units'],
      ['Fund, with comma', '10.5'],
    ];
    expect(parseCsv(toCsv(rows)).rows).toEqual(rows);
  });
});
