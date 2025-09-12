import { MutualFund } from '@/types/mutualFund';

interface ScoringWeights {
  returns: {
    oneYear: number;
    threeYear: number;
    fiveYear: number;
  };
  expenseRatio: number;
  sharpeRatio: number;
  sortinoRatio: number;
  alpha: number;
  informationRatio: number;
  riskAdjustment: number;
}

const defaultWeights: ScoringWeights = {
  returns: {
    oneYear: 0.15,
    threeYear: 0.25,
    fiveYear: 0.2,
  },
  expenseRatio: 0.15,
  sharpeRatio: 0.1,
  sortinoRatio: 0.05,
  alpha: 0.05,
  informationRatio: 0.03,
  riskAdjustment: 0.02,
};

export function calculateFundScore(
  fund: MutualFund,
  weights: ScoringWeights = defaultWeights,
): number {
  let score = 0;

  // Returns scoring (higher is better)
  score += (fund.returns.oneYear || 0) * weights.returns.oneYear;
  score += (fund.returns.threeYear || 0) * weights.returns.threeYear;
  score += (fund.returns.fiveYear || 0) * weights.returns.fiveYear;

  // Expense ratio scoring (lower is better - invert and normalize)
  const expenseScore = Math.max(0, (2 - (fund.expenseRatio || 1)) * 10); // Higher score for lower expense ratio
  score += expenseScore * weights.expenseRatio;

  // Risk-adjusted metrics (higher is better)
  score += (fund.ratios.sharpeRatio || 0) * 10 * weights.sharpeRatio;
  score += (fund.ratios.sortinoRatio || 0) * 5 * weights.sortinoRatio;
  score += (fund.ratios.alpha || 0) * 2 * weights.alpha;
  score += (fund.ratios.informationRatio || 0) * 10 * weights.informationRatio;

  // Risk level adjustment
  const riskMultiplier =
    fund.riskMetrics.riskLevel === 'Low'
      ? 1.1
      : fund.riskMetrics.riskLevel === 'Moderate'
        ? 1.0
        : 0.9;
  score *= 1 + weights.riskAdjustment * (riskMultiplier - 1);

  return Math.round(score * 100) / 100;
}

export function rankFunds(
  funds: MutualFund[],
): Array<MutualFund & { score: number; rank: number }> {
  const scoredFunds = funds.map((fund) => ({
    ...fund,
    score: calculateFundScore(fund),
  }));

  scoredFunds.sort((a, b) => b.score - a.score);

  return scoredFunds.map((fund, index) => ({
    ...fund,
    rank: index + 1,
  }));
}

export function getTopFundsByCategory(
  funds: MutualFund[],
  category: 'Equity' | 'Debt' | 'Hybrid',
  limit: number = 3,
): Array<MutualFund & { score: number; rank: number }> {
  const categoryFunds = funds.filter((fund) => fund.category === category);
  const rankedFunds = rankFunds(categoryFunds);
  return rankedFunds.slice(0, limit);
}

export function getRecommendations(
  funds: MutualFund[],
  riskTolerance: 'Low' | 'Moderate' | 'High',
): Array<MutualFund & { score: number; rank: number; reason: string }> {
  let filteredFunds: MutualFund[];

  switch (riskTolerance) {
    case 'Low':
      filteredFunds = funds.filter(
        (fund) =>
          fund.riskMetrics.riskLevel === 'Low' ||
          (fund.category === 'Hybrid' && fund.riskMetrics.riskLevel === 'Moderate'),
      );
      break;
    case 'Moderate':
      filteredFunds = funds.filter(
        (fund) => fund.riskMetrics.riskLevel === 'Low' || fund.riskMetrics.riskLevel === 'Moderate',
      );
      break;
    case 'High':
      filteredFunds = funds;
      break;
    default:
      filteredFunds = funds;
  }

  const rankedFunds = rankFunds(filteredFunds);

  return rankedFunds.slice(0, 5).map((fund) => ({
    ...fund,
    reason: generateRecommendationReason(fund),
  }));
}

function generateRecommendationReason(fund: MutualFund & { score: number }): string {
  const reasons = [];

  if ((fund.returns.oneYear || 0) > 15) {
    reasons.push('Strong 1-year performance');
  }
  if ((fund.expenseRatio || 1) < 0.5) {
    reasons.push('Low expense ratio');
  }
  if ((fund.ratios.sharpeRatio || 0) > 1.5) {
    reasons.push('Excellent risk-adjusted returns');
  }
  if ((fund.ratios.alpha || 0) > 3) {
    reasons.push('High alpha generation');
  }
  if (fund.aum > 20000) {
    reasons.push('Large AUM indicates investor confidence');
  }

  return reasons.length > 0 ? reasons.join(', ') : 'Balanced performance across metrics';
}
