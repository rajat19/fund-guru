export interface MutualFund {
  id: string;
  schemeName: string;
  fundName: string;
  fundHouse: string;
  category: 'Equity' | 'Debt' | 'Hybrid';
  subCategory: string;
  returns: {
    oneMonth: number;
    threeMonth: number;
    sixMonth: number;
    oneYear: number;
    threeYear: number;
    fiveYear: number;
  };
  expenseRatio: number;
  sharpeRatio: number;
  sortinoRatio: number;
  alpha: number;
  beta: number;
  informationRatio: number;
  standardDeviation: number;
  aum: number; // Assets Under Management in crores
  riskLevel: 'Low' | 'Moderate' | 'High';
}

export const mutualFundsData: MutualFund[] = [
  {
    id: 'MF001',
    schemeName: 'Axis Bluechip Fund',
    fundName: 'Axis Bluechip Fund - Direct Plan - Growth',
    fundHouse: 'Axis Mutual Fund',
    category: 'Equity',
    subCategory: 'Large Cap',
    returns: {
      oneMonth: 2.85,
      threeMonth: 8.45,
      sixMonth: 12.75,
      oneYear: 18.92,
      threeYear: 15.67,
      fiveYear: 13.24
    },
    expenseRatio: 0.45,
    sharpeRatio: 1.42,
    sortinoRatio: 2.18,
    alpha: 2.35,
    beta: 0.95,
    informationRatio: 0.67,
    standardDeviation: 14.8,
    aum: 45230,
    riskLevel: 'Moderate'
  },
  {
    id: 'MF002',
    schemeName: 'ICICI Pru Technology Fund',
    fundName: 'ICICI Prudential Technology Fund - Direct Plan - Growth',
    fundHouse: 'ICICI Prudential Mutual Fund',
    category: 'Equity',
    subCategory: 'Sectoral/Thematic',
    returns: {
      oneMonth: 4.12,
      threeMonth: 11.28,
      sixMonth: 22.15,
      oneYear: 35.67,
      threeYear: 22.89,
      fiveYear: 19.45
    },
    expenseRatio: 0.72,
    sharpeRatio: 1.68,
    sortinoRatio: 2.45,
    alpha: 8.92,
    beta: 1.18,
    informationRatio: 0.89,
    standardDeviation: 21.4,
    aum: 12850,
    riskLevel: 'High'
  },
  {
    id: 'MF003',
    schemeName: 'SBI Corporate Bond Fund',
    fundName: 'SBI Corporate Bond Fund - Direct Plan - Growth',
    fundHouse: 'SBI Mutual Fund',
    category: 'Debt',
    subCategory: 'Corporate Bond',
    returns: {
      oneMonth: 0.58,
      threeMonth: 1.75,
      sixMonth: 3.42,
      oneYear: 6.89,
      threeYear: 7.25,
      fiveYear: 8.12
    },
    expenseRatio: 0.35,
    sharpeRatio: 0.95,
    sortinoRatio: 1.42,
    alpha: 1.25,
    beta: 0.15,
    informationRatio: 0.45,
    standardDeviation: 2.8,
    aum: 18750,
    riskLevel: 'Low'
  },
  {
    id: 'MF004',
    schemeName: 'HDFC Balanced Advantage Fund',
    fundName: 'HDFC Balanced Advantage Fund - Direct Plan - Growth',
    fundHouse: 'HDFC Mutual Fund',
    category: 'Hybrid',
    subCategory: 'Dynamic Asset Allocation',
    returns: {
      oneMonth: 1.95,
      threeMonth: 5.85,
      sixMonth: 9.45,
      oneYear: 14.67,
      threeYear: 12.89,
      fiveYear: 11.25
    },
    expenseRatio: 0.52,
    sharpeRatio: 1.25,
    sortinoRatio: 1.85,
    alpha: 1.85,
    beta: 0.72,
    informationRatio: 0.58,
    standardDeviation: 9.8,
    aum: 32450,
    riskLevel: 'Moderate'
  },
  {
    id: 'MF005',
    schemeName: 'Mirae Asset Large Cap Fund',
    fundName: 'Mirae Asset Large Cap Fund - Direct Plan - Growth',
    fundHouse: 'Mirae Asset Mutual Fund',
    category: 'Equity',
    subCategory: 'Large Cap',
    returns: {
      oneMonth: 3.25,
      threeMonth: 9.12,
      sixMonth: 14.85,
      oneYear: 20.45,
      threeYear: 16.75,
      fiveYear: 14.89
    },
    expenseRatio: 0.42,
    sharpeRatio: 1.58,
    sortinoRatio: 2.25,
    alpha: 3.15,
    beta: 0.98,
    informationRatio: 0.78,
    standardDeviation: 13.9,
    aum: 28940,
    riskLevel: 'Moderate'
  },
  {
    id: 'MF006',
    schemeName: 'Kotak Small Cap Fund',
    fundName: 'Kotak Small Cap Fund - Direct Plan - Growth',
    fundHouse: 'Kotak Mahindra Mutual Fund',
    category: 'Equity',
    subCategory: 'Small Cap',
    returns: {
      oneMonth: 5.85,
      threeMonth: 15.45,
      sixMonth: 28.75,
      oneYear: 42.85,
      threeYear: 25.67,
      fiveYear: 18.92
    },
    expenseRatio: 0.68,
    sharpeRatio: 1.89,
    sortinoRatio: 2.75,
    alpha: 12.45,
    beta: 1.35,
    informationRatio: 1.25,
    standardDeviation: 28.5,
    aum: 8450,
    riskLevel: 'High'
  },
  {
    id: 'MF007',
    schemeName: 'Franklin India Ultra Short Bond Fund',
    fundName: 'Franklin India Ultra Short Bond Fund - Direct Plan - Growth',
    fundHouse: 'Franklin Templeton Mutual Fund',
    category: 'Debt',
    subCategory: 'Ultra Short Duration',
    returns: {
      oneMonth: 0.42,
      threeMonth: 1.28,
      sixMonth: 2.85,
      oneYear: 5.67,
      threeYear: 6.45,
      fiveYear: 7.25
    },
    expenseRatio: 0.28,
    sharpeRatio: 0.85,
    sortinoRatio: 1.25,
    alpha: 0.85,
    beta: 0.08,
    informationRatio: 0.35,
    standardDeviation: 1.2,
    aum: 5680,
    riskLevel: 'Low'
  },
  {
    id: 'MF008',
    schemeName: 'Parag Parikh Flexi Cap Fund',
    fundName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
    fundHouse: 'Parag Parikh Mutual Fund',
    category: 'Equity',
    subCategory: 'Flexi Cap',
    returns: {
      oneMonth: 3.85,
      threeMonth: 10.45,
      sixMonth: 16.75,
      oneYear: 24.89,
      threeYear: 18.92,
      fiveYear: 16.45
    },
    expenseRatio: 0.68,
    sharpeRatio: 1.75,
    sortinoRatio: 2.58,
    alpha: 5.45,
    beta: 1.05,
    informationRatio: 0.95,
    standardDeviation: 16.8,
    aum: 15680,
    riskLevel: 'Moderate'
  }
];