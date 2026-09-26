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
  it('strips plan and option noise', () => {
    expect(
      schemeShortName(fund('Invesco India Contra Fund Direct Plan Growth', 'Invesco Mutual Fund')),
    ).toBe('Invesco India Contra Fund');
    expect(
      schemeShortName(fund('HDFC Gold ETF Fund of Fund Direct Plan Growth', 'HDFC Mutual Fund')),
    ).toBe('HDFC Gold ETF Fund of Fund');
    expect(
      schemeShortName(fund('SBI Large Cap Fund Regular IDCW Payout', 'SBI Mutual Fund')),
    ).toBe('SBI Large Cap Fund');
  });

  it('handles hyphenated plan separators', () => {
    expect(
      schemeShortName(
        fund('Aditya Birla Sun Life Banking & PSU Debt Fund - DIRECT - IDCW', 'Aditya Birla Sun Life Mutual Fund'),
      ),
    ).toBe('Aditya Birla Sun Life Banking & PSU Debt Fund');
  });

  it('falls back to the full name rather than returning empty', () => {
    expect(schemeShortName(fund('HDFC Direct Growth', 'HDFC Mutual Fund'))).toBe(
      'HDFC',
    );
  });
});

describe('schemeLabel', () => {
  it('splits into house and scheme for two-line headers', () => {
    const label = schemeLabel(
      fund('Kotak Multi Factor Passive FoF Direct Growth', 'Kotak Mahindra Mutual Fund'),
    );

    expect(label.house).toBe('Kotak Mahindra');
    expect(label.scheme).toBe('Kotak Multi Factor Passive FoF');
    // The full name is preserved for the title attribute.
    expect(label.full).toBe('Kotak Multi Factor Passive FoF Direct Growth');
  });
});
