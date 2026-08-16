import { describe, expect, it } from 'vitest';
import {
  buildFundMatchIndex,
  looksRegularPlan,
  matchFund,
  nameTokens,
  squashName,
} from '@/utils/fundMatch';
import { makeFund } from '@/utils/__fixtures__/fund';

const universe = [
  makeFund({
    id: 'ppfcf',
    schemeCode: 122639,
    schemeName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
    fundHouse: 'PPFAS Mutual Fund',
    subCategory: 'Flexi Cap Fund',
  }),
  makeFund({
    id: 'hdfc-midcap',
    schemeCode: 118989,
    schemeName: 'HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth',
    fundHouse: 'HDFC Mutual Fund',
    subCategory: 'Mid Cap Fund',
  }),
  makeFund({
    id: 'nippon-smallcap',
    schemeCode: 118778,
    schemeName: 'Nippon India Small Cap Fund - Direct Plan - Growth',
    fundHouse: 'Nippon India Mutual Fund',
    subCategory: 'Small Cap Fund',
  }),
  makeFund({
    id: 'sbi-smallcap',
    schemeCode: 125497,
    schemeName: 'SBI Small Cap Fund - Direct Plan - Growth',
    fundHouse: 'SBI Mutual Fund',
    subCategory: 'Small Cap Fund',
  }),
  makeFund({
    id: 'uti-nifty50',
    schemeCode: 120716,
    schemeName: 'UTI Nifty 50 Index Fund - Direct Plan - Growth',
    fundHouse: 'UTI Mutual Fund',
    subCategory: 'Index Fund',
  }),
  makeFund({
    id: 'uti-nifty500',
    schemeCode: 149112,
    schemeName: 'UTI Nifty 500 Index Fund - Direct Plan - Growth',
    fundHouse: 'UTI Mutual Fund',
    subCategory: 'Index Fund',
  }),
];

const index = buildFundMatchIndex(universe);

describe('nameTokens', () => {
  it('drops plan and option words that carry no signal', () => {
    expect([...nameTokens('HDFC Top 100 Fund - Direct Plan - Growth Option')]).toEqual([
      'hdfc',
      'top',
      '100',
    ]);
  });

  it('normalises spaced and unspaced category words to the same token', () => {
    expect(nameTokens('HDFC Mid Cap Fund')).toEqual(nameTokens('HDFC Midcap Fund'));
    expect(nameTokens('Axis Blue Chip')).toEqual(nameTokens('Axis Bluechip'));
  });

  it('keeps digits, because they distinguish indices', () => {
    expect(nameTokens('Nifty 50 Index Fund')).not.toEqual(nameTokens('Nifty 500 Index Fund'));
  });
});

describe('squashName', () => {
  it('reduces to letters and digits only', () => {
    expect(squashName('HDFC Mid-Cap Opportunities Fund (Direct) - Growth')).toBe(
      'hdfcmidcapopportunitiesfunddirectgrowth',
    );
  });
});

describe('matchFund', () => {
  it('trusts a scheme code over any name', () => {
    const result = matchFund(index, { name: 'Something Else Entirely', schemeCode: 122639 });
    expect(result.fund?.id).toBe('ppfcf');
    expect(result.basis).toBe('scheme-code');
    expect(result.confidence).toBe(1);
  });

  it('falls back to the name when the scheme code is unknown', () => {
    const result = matchFund(index, {
      name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
      schemeCode: 999999,
    });
    expect(result.fund?.id).toBe('ppfcf');
  });

  it('matches across plan and option rewordings', () => {
    for (const name of [
      'Parag Parikh Flexi Cap Fund Direct Growth',
      'PARAG PARIKH FLEXI CAP FUND (DIRECT) GROWTH',
      'Parag Parikh Flexicap Fund-Direct-G',
      'Parag Parikh Flexi Cap Fund - Regular Plan - Growth',
    ]) {
      expect(matchFund(index, { name }).fund?.id, name).toBe('ppfcf');
    }
  });

  it('matches a name written with different punctuation', () => {
    expect(matchFund(index, { name: 'HDFC Mid Cap Opportunities Fund' }).fund?.id).toBe(
      'hdfc-midcap',
    );
  });

  it('matches a truncated export', () => {
    expect(matchFund(index, { name: 'HDFC Mid-Cap Opportunities Fu' }).fund?.id).toBe(
      'hdfc-midcap',
    );
  });

  it('refuses a name that describes a category rather than a scheme', () => {
    // "Small Cap Fund" fits two schemes equally. Resolving it to whichever
    // sorted first would produce a page of analysis about a fund not held.
    const result = matchFund(index, { name: 'Small Cap Fund' });
    expect(result.fund).toBeNull();
    expect(result.ambiguousWith ?? result.bestGuess).not.toBeNull();
  });

  it('distinguishes two indices that differ only by a number', () => {
    expect(matchFund(index, { name: 'UTI Nifty 50 Index Fund Direct Growth' }).fund?.id).toBe(
      'uti-nifty50',
    );
    expect(matchFund(index, { name: 'UTI Nifty 500 Index Fund Direct Growth' }).fund?.id).toBe(
      'uti-nifty500',
    );
  });

  it('does not match one AMC\'s fund to another\'s', () => {
    const result = matchFund(index, { name: 'Nippon India Small Cap Fund - Direct - Growth' });
    expect(result.fund?.id).toBe('nippon-smallcap');
  });

  it('returns the closest guess even when it rejects it, for reporting', () => {
    const result = matchFund(index, { name: 'Quantum Long Term Equity Value Fund' });
    expect(result.fund).toBeNull();
    expect(result.bestGuess).not.toBeNull();
    expect(result.confidence).toBeLessThan(1);
  });

  it('handles an empty or unusable name', () => {
    expect(matchFund(index, { name: '' }).fund).toBeNull();
    expect(matchFund(index, { name: '   ' }).fund).toBeNull();
    expect(matchFund(index, { name: 'Direct Growth Plan' }).fund).toBeNull();
  });
});

describe('looksRegularPlan', () => {
  it('flags the plan markers exports actually use', () => {
    expect(looksRegularPlan('HDFC Top 100 Fund - Regular Plan - Growth')).toBe(true);
    expect(looksRegularPlan('HDFC Top 100 Fund (Regular) Growth')).toBe(true);
    expect(looksRegularPlan('HDFC Top 100 - Regular - IDCW')).toBe(true);
    expect(looksRegularPlan('HDFC Top 100 Fund Regular Growth')).toBe(true);
  });

  it('does not flag a scheme whose own name contains "Regular"', () => {
    // "Regular Savings" is part of the scheme name, not a plan marker. Flagging
    // it would tell a direct-plan holder they are in a regular plan.
    expect(looksRegularPlan('Aditya Birla Sun Life Regular Savings Fund - Direct Growth')).toBe(
      false,
    );
    expect(looksRegularPlan('HDFC Hybrid Debt Fund - Direct Plan - Growth')).toBe(false);
  });
});
