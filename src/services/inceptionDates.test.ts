import { describe, expect, it } from 'vitest';
import { applyInceptionDates, parseInceptionSnapshot } from '@/services/inceptionDates';

/** Header mirrors the live snapshot's 22 columns, abbreviated. */
const HEADER = 'scheme_code,isin,scheme_name,amc,first_date,last_date,is_active,nav';

describe('parseInceptionSnapshot', () => {
  it('extracts scheme code to first NAV date', () => {
    const csv = [
      HEADER,
      '100027,INF123,Some Fund,Some AMC,2006-04-03,2008-05-29,false,10.72',
      '119528,INF456,Other Fund,Other AMC,2013-01-01,2026-08-14,true,412.5',
    ].join('\n');

    const map = parseInceptionSnapshot(csv);
    expect(map.get(100027)).toBe('2006-04-03');
    expect(map.get(119528)).toBe('2013-01-01');
    expect(map.size).toBe(2);
  });

  it('resolves columns from the header rather than assuming positions', () => {
    // Upstream could reorder columns; hardcoded indexes would silently read the
    // wrong field and produce plausible-looking garbage.
    const csv = [
      'first_date,scheme_code,nav',
      '2011-06-15,120503,88.4',
    ].join('\n');

    expect(parseInceptionSnapshot(csv).get(120503)).toBe('2011-06-15');
  });

  it('throws when an expected column is gone', () => {
    expect(() => parseInceptionSnapshot('scheme_code,nav\n100027,10.7')).toThrow(
      /missing expected columns/i,
    );
  });

  it('skips rows with an unusable code or date', () => {
    const csv = [
      HEADER,
      ',INF1,No Code,AMC,2006-04-03,2008-05-29,false,10',
      'abc,INF2,Bad Code,AMC,2006-04-03,2008-05-29,false,10',
      '100028,INF3,No Date,AMC,,2008-05-29,false,10',
      '100029,INF4,Bad Date,AMC,03-04-2006,2008-05-29,false,10',
      '100030,INF5,Good,AMC,2006-04-03,2008-05-29,false,10',
    ].join('\n');

    const map = parseInceptionSnapshot(csv);
    expect(map.size).toBe(1);
    expect(map.get(100030)).toBe('2006-04-03');
  });

  it('keeps the earliest date when a code appears twice', () => {
    const csv = [
      HEADER,
      '100027,INF1,Plan A,AMC,2013-01-01,2026-01-01,true,10',
      '100027,INF1,Plan A,AMC,2006-04-03,2026-01-01,true,10',
    ].join('\n');

    expect(parseInceptionSnapshot(csv).get(100027)).toBe('2006-04-03');
  });

  it('tolerates CRLF line endings and a trailing newline', () => {
    const csv = `${HEADER}\r\n100027,INF1,Fund,AMC,2006-04-03,2008-05-29,false,10\r\n`;
    expect(parseInceptionSnapshot(csv).get(100027)).toBe('2006-04-03');
  });
});

describe('applyInceptionDates', () => {
  const funds = [
    { schemeCode: 100027, inceptionDate: undefined },
    { schemeCode: 119528, inceptionDate: undefined },
    { schemeCode: 999999, inceptionDate: undefined },
  ];

  it('attaches dates for matched codes and leaves the rest alone', () => {
    const dates = new Map([
      [100027, '2006-04-03'],
      [119528, '2013-01-01'],
    ]);

    const { funds: enriched, matched } = applyInceptionDates(funds, dates);

    expect(matched).toBe(2);
    expect(enriched[0].inceptionDate).toBe('2006-04-03');
    expect(enriched[1].inceptionDate).toBe('2013-01-01');
    expect(enriched[2].inceptionDate).toBeUndefined();
  });

  it('is a no-op with an empty map rather than clearing existing values', () => {
    const withExisting = [{ schemeCode: 1, inceptionDate: '2010-01-01' }];
    const { funds: out, matched } = applyInceptionDates(withExisting, new Map());

    expect(matched).toBe(0);
    expect(out[0].inceptionDate).toBe('2010-01-01');
  });

  it('handles an empty fund list without dividing by zero', () => {
    expect(applyInceptionDates([], new Map()).matched).toBe(0);
  });
});
