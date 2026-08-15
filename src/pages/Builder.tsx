import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AlertTriangle, Layers, Wand2, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useMutualFunds, type MutualFundsFilters } from '@/hooks/useMutualFunds';
import { useFundScores } from '@/hooks/useFundScores';
import { useHoldings } from '@/hooks/useHoldings';
import { MutualFund, RiskLevel } from '@/types/mutualFund';
import {
  ALLOCATION_PRESETS,
  ASSET_CLASSES,
  ASSET_CLASS_LABEL,
  type AssetAllocation,
  type AssetClass,
} from '@/utils/assetClass';
import { buildPortfolio } from '@/utils/investmentBuilder';
import { describeOverlap } from '@/utils/overlap';
import { TRACK_RECORD_PRESETS } from '@/utils/trackRecord';
import { formatCurrency, formatPercent } from '@/utils/format';
import { schemeLabel } from '@/utils/schemeName';
import { FundPicker, PinnedFundList } from '@/components/FundPicker';
import { MetricInfoTip } from '@/components/MetricInfoTip';

const RISK_LEVELS: RiskLevel[] = ['Low', 'Moderate', 'High', 'Very High'];

export default function Builder() {
  const navigate = useNavigate();

  const [amount, setAmount] = useState(500_000);
  const [fundCount, setFundCount] = useState(6);
  const [maxRisk, setMaxRisk] = useState<RiskLevel>('Very High');
  const [minTrackRecordYears, setMinTrackRecordYears] = useState(3);
  const [weighting, setWeighting] = useState<'equal' | 'score'>('equal');
  const [allocation, setAllocation] = useState<AssetAllocation>(
    ALLOCATION_PRESETS[1].allocation,
  );

  /*
   * Manual overrides on top of the automatic plan.
   *
   * Pins are stored as ids and resolved against the full universe on render, so
   * a refreshed dataset cannot leave stale fund objects in state.
   */
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);

  // Screening rules, applied before the builder sees the universe.
  const [rules, setRules] = useState<MutualFundsFilters>({ minTrackRecordYears: 0 });

  const { data: candidates = [], isLoading } = useMutualFunds(rules);
  const { context, universe } = useFundScores();
  const { holdings, hasHoldings } = useHoldings();

  const allocationTotal = ASSET_CLASSES.reduce((sum, cls) => sum + (allocation[cls] ?? 0), 0);

  const pinnedFunds = useMemo(() => {
    const wanted = new Set(pinnedIds);
    return universe.filter((fund) => wanted.has(fund.id));
  }, [universe, pinnedIds]);

  const togglePin = (fund: MutualFund) =>
    setPinnedIds((prev) =>
      prev.includes(fund.id) ? prev.filter((id) => id !== fund.id) : [...prev, fund.id],
    );

  /**
   * Removing a fund from the plan.
   *
   * Exclusion rather than "hide it": the plan is re-solved so the freed money
   * goes to another fund in the same asset class, keeping the target split
   * intact. Un-pinning at the same time means a fund the user pinned and then
   * removed does not immediately come back.
   */
  const excludeFund = (fund: MutualFund) => {
    setPinnedIds((prev) => prev.filter((id) => id !== fund.id));
    setExcludedIds((prev) => (prev.includes(fund.id) ? prev : [...prev, fund.id]));
  };

  const restoreAll = () => setExcludedIds([]);

  const portfolio = useMemo(
    () =>
      buildPortfolio(candidates, context, {
        totalAmount: amount,
        maxRisk,
        allocation,
        fundCount,
        minTrackRecordYears,
        weighting,
        holdings,
        pinnedFunds,
        excludedIds,
      }),
    [
      candidates,
      context,
      amount,
      maxRisk,
      allocation,
      fundCount,
      minTrackRecordYears,
      weighting,
      holdings,
      pinnedFunds,
      excludedIds,
    ],
  );

  const setRule = (key: keyof MutualFundsFilters, value: number | undefined) =>
    setRules((prev) => ({ ...prev, [key]: value }));

  const setClass = (cls: AssetClass, value: number) =>
    setAllocation((prev) => ({ ...prev, [cls]: value }));

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              Investment Builder
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Set your rules and a target split, and this divides an amount across specific funds —
              respecting scheme minimums and avoiding funds that hold the same things. Arithmetic
              over public data, not advice.
            </p>
          </CardHeader>

          <CardContent className="space-y-8">
            {/* Amount and shape */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount to invest</Label>
                <NumericInput
                  id="amount"
                  min={0}
                  step={10000}
                  value={amount}
                  // Empty means nothing to allocate; the builder shows its
                  // empty-plan state rather than a plan of zeros.
                  emptyValue={0}
                  onValueChange={(next) => setAmount(next ?? 0)}
                />
                <p className="text-xs text-muted-foreground">{formatCurrency(amount)}</p>
              </div>

              {/* Manual picks. Searches the whole universe, not the filtered set. */}
              <div className="space-y-2">
                <Label>Funds you already hold or want included</Label>
                <FundPicker funds={universe} selectedIds={pinnedIds} onToggle={togglePin} />
                <PinnedFundList funds={pinnedFunds} onRemove={togglePin} />
                <p className="text-xs text-muted-foreground">
                  Pinned funds are always in the plan, even if they fail the rules below — the plan
                  says so when they do.
                </p>
              </div>

              {excludedIds.length > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {excludedIds.length} fund{excludedIds.length === 1 ? '' : 's'} removed from the
                    plan
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={restoreAll}>
                    Restore all
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex justify-between items-baseline">
                  <Label htmlFor="fund-count">Number of funds</Label>
                  <span className="text-sm font-semibold">{fundCount}</span>
                </div>
                <Slider
                  id="fund-count"
                  min={1}
                  max={15}
                  step={1}
                  value={[fundCount]}
                  onValueChange={([next]) => setFundCount(next)}
                />
                <p className="text-xs text-muted-foreground">
                  More funds is not more diversification if they hold the same stocks — the builder
                  checks that.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Highest risk you will hold</Label>
                <Select value={maxRisk} onValueChange={(v: RiskLevel) => setMaxRisk(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Minimum track record</Label>
                <Select
                  value={String(minTrackRecordYears)}
                  onValueChange={(v) => setMinTrackRecordYears(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACK_RECORD_PRESETS.map((p) => (
                      <SelectItem key={p.years} value={String(p.years)}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Asset allocation */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">Asset allocation</h3>
                  <p className="text-xs text-muted-foreground">
                    Weights are normalised, so they need not add to 100.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ALLOCATION_PRESETS.map((preset) => (
                    <Badge
                      key={preset.id}
                      variant="outline"
                      className="cursor-pointer"
                      title={preset.description}
                      onClick={() => setAllocation(preset.allocation)}
                    >
                      {preset.label}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {ASSET_CLASSES.map((cls) => (
                  <div key={cls} className="space-y-2">
                    <Label className="text-xs">{ASSET_CLASS_LABEL[cls]}</Label>
                    <NumericInput
                      min={0}
                      max={100}
                      step={5}
                      value={allocation[cls]}
                      emptyValue={0}
                      onValueChange={(next) => setClass(cls, next ?? 0)}
                    />
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Weights total {allocationTotal}
                {allocationTotal !== 100 && ' — will be scaled to 100'}
              </p>
            </div>

            <Separator />

            {/* Screening rules */}
            <div className="space-y-4">
              <h3 className="font-medium">Screening rules</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Min AUM (₹ Cr)</Label>
                  <Input
                    type="number"
                    placeholder="any"
                    value={rules.minAUM ?? ''}
                    onChange={(e) => setRule('minAUM', e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs inline-flex items-center gap-1.5">
                    Min 1Y return (%)
                    <MetricInfoTip metricKey="oneYear" />
                  </Label>
                  <Input
                    type="number"
                    placeholder="any"
                    value={rules.minReturn ?? ''}
                    onChange={(e) => setRule('minReturn', e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs inline-flex items-center gap-1.5">
                    Max expense ratio (%)
                    <MetricInfoTip metricKey="expenseRatio" />
                  </Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="any"
                    value={rules.maxExpenseRatio ?? ''}
                    onChange={(e) =>
                      setRule('maxExpenseRatio', e.target.value ? Number(e.target.value) : undefined)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs inline-flex items-center gap-1.5">
                    Min Sharpe
                    <MetricInfoTip metricKey="sharpeRatio" />
                  </Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="any"
                    value={rules.minSharpeRatio ?? ''}
                    onChange={(e) =>
                      setRule('minSharpeRatio', e.target.value ? Number(e.target.value) : undefined)
                    }
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{candidates.length} funds pass these rules.</span>
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setWeighting(weighting === 'equal' ? 'score' : 'equal')}
                >
                  Weighting: {weighting === 'equal' ? 'equal rupees' : 'tilted to higher scores'}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Result */}
        {isLoading ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Loading funds…
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-primary" />
                  Suggested split
                </CardTitle>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    <span className="text-muted-foreground">Allocated </span>
                    <strong>{formatCurrency(portfolio.allocatedAmount)}</strong>
                  </span>
                  {portfolio.weightedExpenseRatio != null && (
                    <span>
                      <span className="text-muted-foreground">Blended cost </span>
                      <strong>{formatPercent(portfolio.weightedExpenseRatio)}</strong>
                    </span>
                  )}
                  {portfolio.worstOverlapPercent != null && (
                    <span>
                      <span className="text-muted-foreground">Worst overlap </span>
                      <strong>{formatPercent(portfolio.worstOverlapPercent, 0)}</strong>
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {portfolio.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-300/50 bg-amber-50/50 dark:bg-amber-900/10 p-4 space-y-1.5">
                  {portfolio.warnings.map((warning) => (
                    <div key={warning} className="flex gap-2 text-xs text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}

              {portfolio.classes.map((plan) => (
                <div key={plan.assetClass} className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-medium">
                      {ASSET_CLASS_LABEL[plan.assetClass]}{' '}
                      <span className="text-sm text-muted-foreground font-normal">
                        target {plan.targetPercent.toFixed(0)}% ·{' '}
                        {formatCurrency(plan.targetAmount)}
                      </span>
                    </h3>
                    <span className="text-sm font-semibold">
                      {formatCurrency(plan.allocatedAmount)}
                    </span>
                  </div>

                  {plan.funds.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      {plan.shortfallReason ?? 'Nothing allocated'}
                    </p>
                  ) : (
                    <div className="rounded-lg border border-border divide-y divide-border">
                      {plan.funds.map(({ fund, amount: fundAmount, percent, maxOverlapPercent, overlapWith }) => {
                        const label = schemeLabel(fund);
                        return (
                          <div
                            key={fund.id}
                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
                          >
                            <Checkbox
                              checked
                              aria-label={`Remove ${label.full} from the plan`}
                              // Unchecking removes the fund and re-solves, so the
                              // freed money moves to another fund in this class.
                              onCheckedChange={() => excludeFund(fund)}
                              className="shrink-0"
                            />
                            <div
                              className="min-w-0 flex-1 cursor-pointer"
                              onClick={() => navigate(`/fund/${fund.id}`)}
                            >
                              <div className="font-medium leading-snug" title={label.full}>
                                {label.scheme}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {pinnedIds.includes(fund.id) && (
                                  <span className="text-primary font-medium">Pinned · </span>
                                )}
                                {label.house} · {fund.subCategory} · score{' '}
                                {fund.score.toFixed(0)}
                                {fund.minInvestment != null && (
                                  <> · min {formatCurrency(fund.minInvestment)}</>
                                )}
                              </div>
                              {maxOverlapPercent != null && maxOverlapPercent >= 30 && (
                                <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                  {describeOverlap(maxOverlapPercent)} —{' '}
                                  {maxOverlapPercent.toFixed(0)}% shared with {overlapWith}
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="font-semibold font-mono tabular-nums">
                                {formatCurrency(fundAmount)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {percent.toFixed(1)}% of plan
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}

              {!hasHoldings && (
                <p className="text-xs text-muted-foreground flex gap-2">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Holdings data is unavailable, so overlap between funds could not be checked.
                  Diversification here rests on sub-category and fund house only — two funds in this
                  plan may still hold much the same portfolio.
                </p>
              )}

              {portfolio.unallocatedAmount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(portfolio.unallocatedAmount)} is unallocated.
                </p>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const lines = portfolio.funds.map(
                    (f) => `${f.fund.schemeName}\t${f.amount}\t${f.percent.toFixed(1)}%`,
                  );
                  void navigator.clipboard?.writeText(
                    ['Scheme\tAmount\tShare', ...lines].join('\n'),
                  );
                }}
              >
                Copy as table
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}
