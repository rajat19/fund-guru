import { describe, expect, it } from 'vitest';
import {
  describeTrackRecord,
  hasTrackRecord,
  inceptionAgeYears,
  longestReturnHorizonYears,
  trackRecordOf,
} from '@/utils/trackRecord';
import { makeFund } from '@/utils/__fixtures__/fund';

const NOW = new Date('2026-08-15T00:00:00Z');

describe('longestReturnHorizonYears', () => {
  it('reports the longest populated horizon', () => {
    expect(longestReturnHorizonYears(makeFund({ returns: { tenYear: 12 } }))).toBe(10);
    expect(longestReturnHorizonYears(makeFund({ returns: { fiveYear: 12 } }))).toBe(5);
    expect(longestReturnHorizonYears(makeFund({ returns: { threeYear: 12 } }))).toBe(3);
    expect(longestReturnHorizonYears(makeFund({ returns: { oneYear: 12 } }))).toBe(1);
    expect(longestReturnHorizonYears(makeFund())).toBe(0);
  });

  it('ignores the 6M figure', () => {
    // 6M is an absolute period return, and a fund with only that has no
    // judgeable record.
    expect(longestReturnHorizonYears(makeFund({ returns: { sixMonth: 8 } }))).toBe(0);
  });

  it('treats a zero return as present, not missing', () => {
    expect(longestReturnHorizonYears(makeFund({ returns: { threeYear: 0 } }))).toBe(3);
  });
});

describe('inceptionAgeYears', () => {
  it('computes calendar age from an ISO date', () => {
    const fund = makeFund({ inceptionDate: '2016-08-15' });
    expect(inceptionAgeYears(fund, NOW)).toBeCloseTo(10, 1);
  });

  it('returns null when absent or unparseable', () => {
    expect(inceptionAgeYears(makeFund(), NOW)).toBeNull();
    expect(inceptionAgeYears(makeFund({ inceptionDate: 'not-a-date' }), NOW)).toBeNull();
    expect(inceptionAgeYears(makeFund({ inceptionDate: null }), NOW)).toBeNull();
  });

  it('rejects a future date rather than reporting negative age', () => {
    expect(inceptionAgeYears(makeFund({ inceptionDate: '2030-01-01' }), NOW)).toBeNull();
  });
});

describe('trackRecordOf', () => {
  it('takes the longer of return history and calendar age', () => {
    // The real case this exists for: direct plans only began in Jan 2013, so a
    // scheme running since 2005 shows a 2013 first NAV. A populated 10Y return
    // proves the scheme has 10+ years regardless of what the plan date says.
    const fund = makeFund({
      inceptionDate: '2013-01-01',
      returns: { oneYear: 8, threeYear: 10, fiveYear: 11, tenYear: 12 },
    });

    const record = trackRecordOf(fund, NOW);
    expect(record.years).toBeCloseTo(13.6, 0);
    expect(record.basis).toBe('both');
  });

  it('uses return history when there is no inception date', () => {
    const record = trackRecordOf(makeFund({ returns: { fiveYear: 11 } }), NOW);
    expect(record.years).toBe(5);
    expect(record.basis).toBe('returns');
    expect(record.inceptionAgeYears).toBeNull();
  });

  it('uses the inception date when returns are missing', () => {
    // A fund 18 months old may have no 1Y figure yet in the feed, but its age is
    // still known and still disqualifying for a long-term screen.
    const record = trackRecordOf(makeFund({ inceptionDate: '2025-02-15' }), NOW);
    expect(record.basis).toBe('inception');
    expect(record.years).toBeCloseTo(1.5, 1);
  });

  it('flags a fund with neither signal as new', () => {
    const record = trackRecordOf(makeFund(), NOW);
    expect(record.years).toBe(0);
    expect(record.basis).toBe('none');
    expect(record.isNew).toBe(true);
  });

  it('flags a sub-1-year fund as new even with a 6M return', () => {
    const record = trackRecordOf(
      makeFund({ inceptionDate: '2026-04-01', returns: { sixMonth: 14 } }),
      NOW,
    );
    expect(record.isNew).toBe(true);
  });
});

describe('hasTrackRecord', () => {
  const veteran = makeFund({
    inceptionDate: '2013-01-01',
    returns: { oneYear: 8, threeYear: 10, fiveYear: 11, tenYear: 12 },
  });
  const infant = makeFund({ inceptionDate: '2026-06-01' });

  it('gates on the requested number of years', () => {
    expect(hasTrackRecord(veteran, 10, NOW)).toBe(true);
    expect(hasTrackRecord(veteran, 3, NOW)).toBe(true);
    expect(hasTrackRecord(infant, 3, NOW)).toBe(false);
    expect(hasTrackRecord(infant, 1, NOW)).toBe(false);
  });

  it('lets everything through at zero', () => {
    expect(hasTrackRecord(infant, 0, NOW)).toBe(true);
  });
});

describe('describeTrackRecord', () => {
  it('describes the common cases readably', () => {
    expect(describeTrackRecord(trackRecordOf(makeFund(), NOW))).toBe('No usable history');
    expect(
      describeTrackRecord(trackRecordOf(makeFund({ inceptionDate: '2026-06-01' }), NOW)),
    ).toBe('Under 1 year');
    expect(describeTrackRecord(trackRecordOf(makeFund({ returns: { fiveYear: 11 } }), NOW))).toBe(
      '5 years',
    );
  });

  it('discloses the plan floor when return history outruns the NAV record', () => {
    // Observed in live data: 584 funds whose longest horizon is 10Y, of which the
    // youngest NAV record is only 3 years old. The scheme is old; the plan's NAV
    // series is not. Reporting "10 years" without noting that is misleading.
    const text = describeTrackRecord(
      trackRecordOf(makeFund({ inceptionDate: '2023-08-15', returns: { tenYear: 12 } }), NOW),
    );
    expect(text).toMatch(/direct plan since/i);
    expect(text).toMatch(/10/);
  });

  it('stays quiet when the two signals agree', () => {
    const text = describeTrackRecord(
      trackRecordOf(makeFund({ inceptionDate: '2013-01-01', returns: { tenYear: 12 } }), NOW),
    );
    expect(text).not.toMatch(/direct plan since/i);
  });
});
