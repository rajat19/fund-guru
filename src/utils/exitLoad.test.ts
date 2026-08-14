import { describe, expect, it } from 'vitest';
import { applyExitLoad, describeExitLoad, parseExitLoad } from '@/utils/exitLoad';

/**
 * Every string in this file is a verbatim `exit_load` value pulled from the live
 * feed across 160 schemes. The parser is only worth anything if it handles the
 * real distribution, not an idealised grammar.
 */
describe('parseExitLoad — no load', () => {
  it('treats the explicit and implicit nil forms as no load', () => {
    for (const raw of ['Nil', 'nil', 'NIL', 'None', 'NA', 'N/A', '', '   ', null, undefined]) {
      expect(parseExitLoad(raw).kind).toBe('none');
    }
  });

  it('reports zero charge whatever the holding period', () => {
    const applied = applyExitLoad(parseExitLoad('Nil'), 0.1);
    expect(applied.ratePercent).toBe(0);
    expect(applied.uncertain).toBe(false);
  });
});

describe('parseExitLoad — flat load', () => {
  const cases: Array<[string, number, number]> = [
    ['Exit load of 1%, if redeemed within 15 days.', 1, 15],
    ['Exit load of 0.25%, if redeemed within 7 days.', 0.25, 7],
    ['Exit load of 1% if redeemed within 1 year', 1, 365],
    ['Exit load of 1%, if redeemed within 365 days.', 1, 365],
    ['Exit load of 0.50%, if redeemed within 3 months.', 0.5, 3 * 30.44],
    ['Exit load of 1% if redeemed within 30 days.', 1, 30],
    ['Exit load of 1% if redeemed less than 12 months', 1, 12 * 30.44],
  ];

  it.each(cases)('parses %s', (raw, rate, days) => {
    const policy = parseExitLoad(raw);
    expect(policy.kind).toBe('flat');
    expect(policy.tiers[0].ratePercent).toBeCloseTo(rate, 4);
    expect(policy.tiers[0].withinDays).toBeCloseTo(days, 1);
    expect(policy.freeFraction).toBe(0);
  });

  it('charges inside the window and nothing outside it', () => {
    const policy = parseExitLoad('Exit load of 1% if redeemed within 1 year');

    const inside = applyExitLoad(policy, 6);
    expect(inside.ratePercent).toBe(1);
    expect(inside.chargeableFraction).toBe(1);
    expect(inside.daysUntilFree).toBeGreaterThan(0);

    const outside = applyExitLoad(policy, 13);
    expect(outside.ratePercent).toBe(0);
    expect(outside.daysUntilFree).toBe(0);
  });

  it('handles a sub-month window against a whole-month holding', () => {
    // A 15-day load never applies at the slider's 1-month minimum.
    const policy = parseExitLoad('Exit load of 1%, if redeemed within 15 days.');
    expect(applyExitLoad(policy, 1).ratePercent).toBe(0);
  });
});

describe('parseExitLoad — free-limit load', () => {
  // ~1 in 5 live schemes use this form. Applying the headline rate to the whole
  // redemption overstates the cost by up to 10x, which is why it is parsed
  // separately rather than falling through to the flat branch.
  const raw =
    'Exit load for units in excess of 10% of the investment, 1% will be charged for redemption within 1 year.';

  it('extracts the free allowance separately from the rate', () => {
    const policy = parseExitLoad(raw);
    expect(policy.kind).toBe('free-limit');
    expect(policy.freeFraction).toBeCloseTo(0.1, 6);
    expect(policy.tiers[0].ratePercent).toBe(1);
    expect(policy.tiers[0].withinDays).toBeCloseTo(365, 1);
  });

  it('does not mistake the 10% allowance for the load rate', () => {
    const policy = parseExitLoad(raw);
    expect(policy.tiers[0].ratePercent).not.toBe(10);
  });

  it('charges the rate on only the chargeable fraction', () => {
    const applied = applyExitLoad(parseExitLoad(raw), 6);
    expect(applied.ratePercent).toBe(1);
    expect(applied.chargeableFraction).toBeCloseTo(0.9, 6);
  });

  it.each([
    ['Exit Load for units in excess of 12% of the investment,1% will be charged for redemption within 12 months.', 0.12],
    ['Exit Load for units in excess of 20% of the investment,1% will be charged for redemption within 12 months.', 0.2],
    ['Exit Load for units in excess of 15% of the investment,1% will be charged for redemption within 1 years.', 0.15],
    ['For units more than 25% of the investments, an exit load of 1% if redeemed within 365 days.', 0.25],
  ])('handles the allowance variant %s', (raw2, expected) => {
    const policy = parseExitLoad(raw2);
    expect(policy.freeFraction).toBeCloseTo(expected, 6);
    expect(policy.tiers[0].ratePercent).toBe(1);
  });

  it('tolerates the missing space after the comma seen in live data', () => {
    const policy = parseExitLoad(
      'Exit Load for units in excess of 10% of the investment,1% will be charged for redemption within 3 months.',
    );
    expect(policy.kind).toBe('free-limit');
    expect(policy.tiers[0].withinDays).toBeCloseTo(3 * 30.44, 1);
  });
});

describe('parseExitLoad — graded load', () => {
  const raw =
    'With respect to units not subject to lock-in period and the holding period is less than 3 years: Exit load of 3% if redeemed within 1 year, 2% if redeemed after 1 year but within 2 year, 1% if redeemed after 2 year but within 3 year.';

  it('keeps every band rather than collapsing to the first rate', () => {
    const policy = parseExitLoad(raw);
    expect(policy.kind).toBe('tiered');
    expect(policy.tiers.map((t) => t.ratePercent)).toEqual([3, 2, 1]);
  });

  it('picks the band matching the holding period', () => {
    const policy = parseExitLoad(raw);
    expect(applyExitLoad(policy, 6).ratePercent).toBe(3);
    expect(applyExitLoad(policy, 18).ratePercent).toBe(2);
    expect(applyExitLoad(policy, 30).ratePercent).toBe(1);
    expect(applyExitLoad(policy, 40).ratePercent).toBe(0);
  });
});

describe('parseExitLoad — phrasing variants found in live data', () => {
  it('handles "on or before completion of"', () => {
    const policy = parseExitLoad(
      '0.5% if redeemed/switched out on or before completion of 3 months from the date of allotment of units',
    );
    expect(policy.kind).toBe('flat');
    expect(policy.tiers[0].ratePercent).toBe(0.5);
    expect(policy.tiers[0].withinDays).toBeCloseTo(3 * 30.44, 1);
  });

  it('handles spelled-out durations', () => {
    const policy = parseExitLoad('Exit load of 1% if redeemed within one year.');
    expect(policy.kind).toBe('flat');
    expect(policy.tiers[0].withinDays).toBeCloseTo(365, 1);
  });

  it('handles the "if units in excess of N%" allowance phrasing', () => {
    const policy = parseExitLoad(
      'Exit load of 0.50% if units in excess of 15% are redeemed or switched-out within 90 days',
    );
    expect(policy.kind).toBe('free-limit');
    expect(policy.freeFraction).toBeCloseTo(0.15, 6);
    expect(policy.tiers[0].ratePercent).toBe(0.5);
  });

  it('fails safe on the inverted "a 0.50% load applies" phrasing', () => {
    // This one states the window before the rate ("...redeemed within 6 months
    // ... a 0.50% load applies"), which the rate-then-window pairing cannot
    // reach. It is 1 of 252 live strings, and contorting the grammar to catch it
    // risks mispairing the 251 that work — so it is left as 'unknown', which
    // surfaces as "check the scheme document" rather than a wrong number.
    const policy = parseExitLoad(
      'No exit load on 10% of units redeemed within 6 months. Beyond 10% within 6 months, a 0.50% load applies.',
    );
    expect(policy.kind).toBe('unknown');
    expect(applyExitLoad(policy, 3).uncertain).toBe(true);
  });

  it('leaves source-data typos unparsed rather than fuzzy-matching them', () => {
    // "wirhin"/"wtihin" appear in the real feed. Edit-distance matching on
    // keywords would invite false positives on genuinely different terms, and a
    // wrong exit load is worse than an honest "check the SID".
    expect(parseExitLoad('Exit load of 0.1% if redeemed wirhin 30 days.').kind).toBe('unknown');
  });
});

describe('parseExitLoad — unparseable', () => {
  it('reports uncertainty instead of silently assuming no load', () => {
    // The dangerous failure mode: quietly returning 0% for a fund that charges.
    const policy = parseExitLoad(
      'Exit load as per the terms set out in the scheme information document.',
    );
    expect(policy.kind).toBe('unknown');

    const applied = applyExitLoad(policy, 3);
    expect(applied.uncertain).toBe(true);
    expect(applied.note).toMatch(/scheme information document/i);
  });

  it('rejects an implausible rate rather than trusting it', () => {
    expect(parseExitLoad('Exit load of 95% if redeemed within 1 year').kind).toBe('unknown');
  });

  it('rejects a rate with no window', () => {
    expect(parseExitLoad('Exit load of 1% may apply.').kind).toBe('unknown');
  });
});

describe('describeExitLoad', () => {
  it('summarises each shape for display', () => {
    expect(describeExitLoad(parseExitLoad('Nil'))).toBe('None');
    expect(describeExitLoad(parseExitLoad('Exit load of 1% if redeemed within 1 year'))).toBe(
      'up to 1% within 1 year',
    );
    expect(describeExitLoad(parseExitLoad('Exit load of 0.25%, if redeemed within 7 days.'))).toBe(
      'up to 0.25% within 7 days',
    );
    expect(
      describeExitLoad(
        parseExitLoad(
          'Exit load for units in excess of 10% of the investment, 1% will be charged for redemption within 1 year.',
        ),
      ),
    ).toBe('up to 1% within 1 year, first 10% free');
    expect(describeExitLoad(parseExitLoad('unreadable gibberish'))).toBe('See scheme document');
  });
});
