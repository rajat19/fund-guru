import { describe, expect, it } from 'vitest';
import { fundHouseShortName, schemeLabel, schemeShortName } from '@/utils/schemeName';
import { makeFund } from '@/utils/__fixtures__/fund';

const fund = (schemeName: string, fundHouse: string) =>
  makeFund({ schemeName, fundHouse });

describe('fundHouseShortName', () => {
  it('drops the corporate suffix', () => {
    expect(fundHouseShortName('Motilal Oswal Mutual Fund')).toBe('Motilal Oswal');
    expect(fundHouseShortName('Kotak Mahindra Mutual Fund')).toBe('Kotak Mahindra');
    expect(fundHouseShortName('Groww Mutual Fund')).toBe('Groww');
  });

  it('keeps "India" when it is part of the name proper', () => {
    // "Bank of India Mutual Fund" -> "Bank of India", not "Bank of".
    expect(fundHouseShortName('Bank of India Mutual Fund')).toBe('Bank of India');
    expect(fundHouseShortName('Nippon India Mutual Fund')).toBe('Nippon India');
  });

  it('handles missing input', () => {
    expect(fundHouseShortName(null)).toBe('');
    expect(fundHouseShortName(undefined)).toBe('');
  });
});

describe('schemeShortName', () => {
  // The bug: taking the first two words gave "Motilal Oswal" for every Motilal
  // scheme, so two different funds were identical in a comparison header, and
  // "Bank of India Small Cap Fund" collapsed to the fragment "Bank of".
  it('keeps the part that distinguishes sibling schemes', () => {
    const a = fund('Motilal Oswal Multi Factor Passive FoF Direct Growth', 'Motilal Oswal Mutual Fund');
    const b = fund('Motilal Oswal Midcap Fund Direct Growth', 'Motilal Oswal Mutual Fund');

    expect(schemeShortName(a)).toBe('Multi Factor Passive FoF');
    expect(schemeShortName(b)).toBe('Midcap Fund');
    expect(schemeShortName(a)).not.toBe(schemeShortName(b));
  });

  it('does not produce a dangling preposition', () => {
    expect(
      schemeShortName(fund('Bank of India Small Cap Fund Direct Growth', 'Bank of India Mutual Fund')),
    ).toBe('Small Cap Fund');
  });

  it('strips plan and option noise', () => {
    // The house is rendered on its own line, so repeating "Invesco" in the
    // scheme label would be noise.
    expect(
      schemeShortName(fund('Invesco India Contra Fund Direct Plan Growth', 'Invesco Mutual Fund')),
    ).toBe('India Contra Fund');
    expect(
      schemeShortName(fund('HDFC Gold ETF Fund of Fund Direct Plan Growth', 'HDFC Mutual Fund')),
    ).toBe('Gold ETF Fund of Fund');
    expect(
      schemeShortName(fund('SBI Large Cap Fund Regular IDCW Payout', 'SBI Mutual Fund')),
    ).toBe('Large Cap Fund');
  });

  it('handles hyphenated plan separators', () => {
    expect(
      schemeShortName(
        fund('Aditya Birla Sun Life Banking & PSU Debt Fund - DIRECT - IDCW', 'Aditya Birla Sun Life Mutual Fund'),
      ),
    ).toBe('Banking & PSU Debt Fund');
  });

  it('falls back to the full name rather than returning empty', () => {
    // A scheme whose entire name is the house plus plan noise would otherwise
    // shorten to nothing.
    expect(schemeShortName(fund('HDFC Direct Growth', 'HDFC Mutual Fund'))).toBe(
      'HDFC Direct Growth',
    );
  });

  it('leaves the name alone when it does not start with the house', () => {
    expect(
      schemeShortName(fund('Quantum Long Term Equity Value Fund', 'Some Other AMC Mutual Fund')),
    ).toBe('Quantum Long Term Equity Value Fund');
  });

  it('matches a partial house prefix', () => {
    // Real mismatch: the house is "Kotak Mahindra Mutual Fund" but its schemes
    // are named "Kotak ...", so an exact match would strip nothing.
    expect(
      schemeShortName(
        fund('Kotak Multi Factor Passive FoF Direct Growth', 'Kotak Mahindra Mutual Fund'),
      ),
    ).toBe('Multi Factor Passive FoF');
  });

  it('is case-insensitive about the house prefix', () => {
    expect(
      schemeShortName(fund('HDFC NIFTY Midcap 150 Index Fund Direct Growth', 'hdfc mutual fund')),
    ).toBe('NIFTY Midcap 150 Index Fund');
  });
});

describe('schemeLabel', () => {
  it('splits into house and scheme for two-line headers', () => {
    const label = schemeLabel(
      fund('Kotak Multi Factor Passive FoF Direct Growth', 'Kotak Mahindra Mutual Fund'),
    );

    expect(label.house).toBe('Kotak Mahindra');
    expect(label.scheme).toBe('Multi Factor Passive FoF');
    // The full name is preserved for the title attribute.
    expect(label.full).toBe('Kotak Multi Factor Passive FoF Direct Growth');
  });
});
