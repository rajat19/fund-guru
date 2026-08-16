import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Info,
  Layers,
  PieChart as PieChartIcon,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatPercent } from '@/utils/format';
import { schemeLabel, schemeShortName } from '@/utils/schemeName';
import { ASSET_CLASS_LABEL } from '@/utils/assetClass';
import {
  HOLDING_VERDICT_LABEL,
  SIP_VERDICT_LABEL,
  type EvaluatedHolding,
  type EvaluatedSip,
  type HoldingVerdict,
  type PortfolioEvaluation,
  type SignalTone,
  type SipVerdict,
  type SuggestionSeverity,
} from '@/utils/holdingsEvaluation';
import { SIP_FREQUENCY_LABEL } from '@/types/userHoldings';

/**
 * The read-out.
 *
 * Two things drive the layout. First, the *reason* is the product — a badge
 * saying "worth switching" with no arithmetic behind it is an instruction, and
 * this app does not give instructions. So every verdict is rendered with the
 * sentence that produced it, always visible rather than behind a disclosure.
 *
 * Second, holdings and SIPs are separate sections rather than one merged table,
 * because the same fund can honestly carry different verdicts in each — keeping
 * units whose gain is expensive to realise while pointing new instalments
 * elsewhere. Merging them would force one answer where there are two.
 */

const VERDICT_STYLE: Record<HoldingVerdict, string> = {
  keep: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  watch:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  trim: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800',
  exit: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800',
  unjudged: 'bg-muted text-muted-foreground',
};

const SIP_VERDICT_STYLE: Record<SipVerdict, string> = {
  continue: VERDICT_STYLE.keep,
  review: VERDICT_STYLE.watch,
  redirect: VERDICT_STYLE.exit,
  unjudged: VERDICT_STYLE.unjudged,
};

/** Chart fill per verdict. Hex rather than a CSS variable, since Recharts
 *  writes these straight into an SVG `fill` attribute. */
const VERDICT_FILL: Record<HoldingVerdict, string> = {
  keep: '#10b981',
  watch: '#f59e0b',
  trim: '#0ea5e9',
  exit: '#f43f5e',
  unjudged: '#94a3b8',
};

const TONE_CLASS: Record<SignalTone, string> = {
  good: 'text-profit',
  neutral: 'text-muted-foreground',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-loss',
};

const SEVERITY_STYLE: Record<SuggestionSeverity, string> = {
  good: 'border-emerald-300/50 bg-emerald-50/50 dark:bg-emerald-900/10',
  info: 'border-border bg-muted/30',
  warn: 'border-amber-300/50 bg-amber-50/50 dark:bg-amber-900/10',
  bad: 'border-rose-300/50 bg-rose-50/50 dark:bg-rose-900/10',
};

const SEVERITY_ICON: Record<SuggestionSeverity, typeof Info> = {
  good: CheckCircle2,
  info: Info,
  warn: AlertTriangle,
  bad: AlertTriangle,
};

interface TileProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'profit' | 'loss' | 'plain';
  icon?: typeof Info;
}

function Tile({ label, value, sub, tone = 'plain', icon: Icon }: TileProps) {
  const toneClass =
    tone === 'profit' ? 'text-profit' : tone === 'loss' ? 'text-loss' : 'text-foreground';

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-2">
          {Icon && <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HoldingRow({
  evaluated,
  onRemove,
}: {
  evaluated: EvaluatedHolding;
  onRemove: (id: string) => void;
}) {
  const { fund, holding, standing, breakdown } = evaluated;
  const label = fund ? schemeLabel(fund) : null;

  return (
    <div className="px-4 py-3.5 space-y-2 hover:bg-muted/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {fund ? (
              <Link to={`/fund/${fund.id}`} className="font-medium leading-snug hover:underline">
                {label!.scheme}
              </Link>
            ) : (
              <span className="font-medium leading-snug">{holding.sourceName}</span>
            )}
            <Badge variant="outline" className={VERDICT_STYLE[evaluated.verdict]}>
              {HOLDING_VERDICT_LABEL[evaluated.verdict]}
            </Badge>
            {evaluated.rank > 0 && (
              <span className="text-xs text-muted-foreground">#{evaluated.rank} of yours</span>
            )}
          </div>

          <div className="text-xs text-muted-foreground mt-0.5">
            {label ? (
              <>
                {label.house} · {fund!.subCategory}
                {standing != null && <> · stands {Math.round(standing)}/100 in its sub-category</>}
                {breakdown && <> · {breakdown.peerCount} peers</>}
              </>
            ) : (
              <>Unmatched — excluded from every figure</>
            )}
            {holding.folio && <> · folio {holding.folio}</>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="font-semibold font-mono tabular-nums">
            {evaluated.currentValue != null ? formatCurrency(evaluated.currentValue) : '—'}
          </div>
          <div className="text-xs text-muted-foreground">
            {evaluated.gainPercent != null ? (
              <span className={evaluated.gainPercent >= 0 ? 'text-profit' : 'text-loss'}>
                {evaluated.gainPercent >= 0 ? '+' : ''}
                {evaluated.gainPercent.toFixed(1)}%
              </span>
            ) : (
              'gain unknown'
            )}
            {evaluated.weightPercent > 0 && <> · {evaluated.weightPercent.toFixed(1)}% of total</>}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={`Remove ${fund?.schemeName ?? holding.sourceName}`}
          onClick={() => onRemove(holding.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* The reason is the point of the verdict, so it is never hidden. */}
      <p className="text-xs text-muted-foreground leading-relaxed">{evaluated.verdictReason}</p>

      {evaluated.betterPeer && (
        <div className="text-xs flex items-start gap-1.5 text-muted-foreground">
          <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Highest-ranked alternative in {evaluated.betterPeer.fund.subCategory}:{' '}
            <Link to={`/fund/${evaluated.betterPeer.fund.id}`} className="hover:underline font-medium">
              {schemeShortName(evaluated.betterPeer.fund)}
            </Link>{' '}
            at {Math.round(evaluated.betterPeer.standing)}/100
            {evaluated.betterPeer.annualAdvantage != null && (
              <>
                {' '}
                ({evaluated.betterPeer.annualAdvantage > 0 ? '+' : ''}
                {evaluated.betterPeer.annualAdvantage.toFixed(1)} points on{' '}
                {evaluated.betterPeer.advantageBasis})
              </>
            )}
            . Ranking, not a recommendation.
          </span>
        </div>
      )}

      {evaluated.cheaperTracker && (
        <div className="text-xs flex items-start gap-1.5 text-muted-foreground">
          <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Same benchmark, lower fee:{' '}
            <Link
              to={`/fund/${evaluated.cheaperTracker.fund.id}`}
              className="hover:underline font-medium"
            >
              {schemeShortName(evaluated.cheaperTracker.fund)}
            </Link>{' '}
            at {formatPercent(evaluated.cheaperTracker.expenseRatio)} against{' '}
            {formatPercent(evaluated.fund?.expenseRatio)}
            {evaluated.cheaperTracker.annualSavingRupees != null && (
              <>
                {' '}
                — about {formatCurrency(evaluated.cheaperTracker.annualSavingRupees)} a year on this
                position
              </>
            )}
            . Both track {evaluated.fund?.benchmarkName}.
          </span>
        </div>
      )}

      {evaluated.signals.length > 0 && (
        <ul className="space-y-1">
          {evaluated.signals.map((signal) => (
            <li key={signal.kind + signal.message} className={`text-xs ${TONE_CLASS[signal.tone]}`}>
              · {signal.message}
            </li>
          ))}
        </ul>
      )}

      {evaluated.switchCost?.totalAmount != null && evaluated.switchCost.totalAmount > 0 && (
        <div className="text-xs text-muted-foreground rounded-md bg-muted/40 px-2.5 py-1.5">
          Leaving today costs {formatCurrency(evaluated.switchCost.totalAmount)} —{' '}
          {formatCurrency(evaluated.switchCost.exitLoadAmount)} exit load and{' '}
          {formatCurrency(evaluated.switchCost.taxAmount ?? 0)}{' '}
          {evaluated.switchCost.isLongTerm ? 'long-term' : 'short-term'} capital gains tax
          {evaluated.switchCost.percentOfValue != null && (
            <> ({evaluated.switchCost.percentOfValue.toFixed(1)}% of the position)</>
          )}
          {evaluated.breakEvenYears != null && (
            <>, about {evaluated.breakEvenYears.toFixed(1)} years of the return gap to recover</>
          )}
          .
        </div>
      )}
    </div>
  );
}

function SipRow({
  evaluated,
  onRemove,
}: {
  evaluated: EvaluatedSip;
  onRemove: (id: string) => void;
}) {
  const { fund, sip, standing } = evaluated;
  const label = fund ? schemeLabel(fund) : null;

  return (
    <div className="px-4 py-3.5 space-y-2 hover:bg-muted/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {fund ? (
              <Link to={`/fund/${fund.id}`} className="font-medium leading-snug hover:underline">
                {label!.scheme}
              </Link>
            ) : (
              <span className="font-medium leading-snug">{sip.sourceName}</span>
            )}
            <Badge variant="outline" className={SIP_VERDICT_STYLE[evaluated.verdict]}>
              {SIP_VERDICT_LABEL[evaluated.verdict]}
            </Badge>
            {!sip.active && <Badge variant="secondary">Inactive</Badge>}
          </div>

          <div className="text-xs text-muted-foreground mt-0.5">
            {label ? (
              <>
                {label.house} · {fund!.subCategory}
                {standing != null && <> · stands {Math.round(standing)}/100</>}
              </>
            ) : (
              <>Unmatched — excluded from every figure</>
            )}
            {sip.startDate && <> · since {sip.startDate}</>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="font-semibold font-mono tabular-nums">
            {sip.amount != null ? formatCurrency(sip.amount) : '—'}
          </div>
          <div className="text-xs text-muted-foreground">
            {SIP_FREQUENCY_LABEL[sip.frequency]}
            {evaluated.monthlyEquivalent != null && sip.frequency !== 'monthly' && (
              <> · {formatCurrency(evaluated.monthlyEquivalent)}/mo</>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={`Remove ${fund?.schemeName ?? sip.sourceName}`}
          onClick={() => onRemove(sip.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{evaluated.verdictReason}</p>

      {evaluated.signals.length > 0 && (
        <ul className="space-y-1">
          {evaluated.signals.map((signal) => (
            <li key={signal.kind + signal.message} className={`text-xs ${TONE_CLASS[signal.tone]}`}>
              · {signal.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface HoldingsEvaluationViewProps {
  evaluation: PortfolioEvaluation;
  onRemoveHolding: (id: string) => void;
  onRemoveSip: (id: string) => void;
}

export function HoldingsEvaluationView({
  evaluation,
  onRemoveHolding,
  onRemoveSip,
}: HoldingsEvaluationViewProps) {
  const { totals, sipTotals, allocation, lookThrough } = evaluation;

  const standingChart = evaluation.holdings
    .filter((holding) => holding.standing != null && holding.fund != null)
    .sort((a, b) => (b.standing ?? 0) - (a.standing ?? 0))
    .map((holding) => ({
      name: schemeShortName(holding.fund!),
      standing: Math.round(holding.standing!),
      verdict: holding.verdict,
    }));

  const allocationChart = allocation.map((row) => ({
    name: ASSET_CLASS_LABEL[row.assetClass],
    current: row.currentPercent,
    target: row.targetPercent,
  }));

  const hasTarget = allocation.some((row) => row.targetPercent != null);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tile
          label="Invested"
          value={totals.invested != null ? formatCurrency(totals.invested) : '—'}
          sub={`${totals.matchedCount} of ${totals.rowCount} rows matched a scheme`}
        />
        <Tile
          label="Current value"
          value={totals.currentValue != null ? formatCurrency(totals.currentValue) : '—'}
          icon={TrendingUp}
        />
        <Tile
          label="Gain"
          value={
            totals.gain != null
              ? `${totals.gain >= 0 ? '+' : ''}${formatCurrency(totals.gain)}`
              : '—'
          }
          sub={totals.gainPercent != null ? `${totals.gainPercent.toFixed(2)}% on cost` : undefined}
          tone={totals.gain == null ? 'plain' : totals.gain >= 0 ? 'profit' : 'loss'}
          icon={totals.gain != null && totals.gain < 0 ? TrendingDown : TrendingUp}
        />
        <Tile
          label="Fees a year"
          value={
            evaluation.annualCostRupees != null
              ? formatCurrency(evaluation.annualCostRupees)
              : '—'
          }
          sub={
            evaluation.weightedExpenseRatio != null
              ? `${formatPercent(evaluation.weightedExpenseRatio)} money-weighted, already inside NAV`
              : undefined
          }
        />
      </div>

      {(sipTotals.monthlyTotal != null || evaluation.weightedStanding != null) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {evaluation.weightedStanding != null && (
            <Tile
              label="Money-weighted peer standing"
              value={`${evaluation.weightedStanding.toFixed(0)}/100`}
              sub="Percentile within each fund's own sub-category, weighted by the money in it"
            />
          )}
          {sipTotals.monthlyTotal != null && (
            <Tile
              label="Monthly instalments"
              value={formatCurrency(sipTotals.monthlyTotal)}
              sub={`${sipTotals.activeCount} active · ${formatCurrency(sipTotals.annualTotal ?? 0)} a year`}
            />
          )}
          {sipTotals.monthlyIntoWeak != null && sipTotals.monthlyIntoWeak > 0 && (
            <Tile
              label="Monthly into bottom-ranked funds"
              value={formatCurrency(sipTotals.monthlyIntoWeak)}
              sub="Redirecting future instalments costs nothing"
              tone="loss"
            />
          )}
        </div>
      )}

      {/* Suggestions */}
      {evaluation.suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              What the numbers say
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {evaluation.suggestions.map((suggestion) => {
              const Icon = SEVERITY_ICON[suggestion.severity];
              return (
                <div
                  key={suggestion.id}
                  className={`rounded-lg border p-3.5 ${SEVERITY_STYLE[suggestion.severity]}`}
                >
                  <div className="flex gap-2.5">
                    <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="space-y-1 min-w-0">
                      <div className="font-medium text-sm">{suggestion.title}</div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {suggestion.detail}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {standingChart.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-5 w-5" />
                Where each holding stands against its own peers
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Percentile within the fund&apos;s own sub-category. 50 is the median peer. The risk
                tilt is deliberately excluded, so an equity fund is not marked down for being equity.
              </p>
            </CardHeader>
            <CardContent>
              <div style={{ height: Math.max(180, standingChart.length * 34) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={standingChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tick={{ fontSize: 11 }}
                      interval={0}
                    />
                    <Tooltip
                      formatter={(value: number) => [`${value}/100`, 'Peer standing']}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="standing" radius={[0, 4, 4, 0]}>
                      {standingChart.map((entry) => (
                        <Cell key={entry.name} fill={VERDICT_FILL[entry.verdict]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {allocationChart.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PieChartIcon className="h-5 w-5" />
                Asset mix{hasTarget ? ' against your target' : ''}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                By current value, over the holdings that matched a scheme.
                {hasTarget && ' Drift can be corrected with new money rather than by selling.'}
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={allocationChart} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis unit="%" tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) => `${value.toFixed(1)}%`}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="current" name="Yours" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    {hasTarget && (
                      <Bar dataKey="target" name="Target" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-3 space-y-1.5">
                {allocation.map((row) => (
                  <div key={row.assetClass} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">
                      {ASSET_CLASS_LABEL[row.assetClass]}
                    </span>
                    <span className="tabular-nums">
                      {formatCurrency(row.amount)} · {row.currentPercent.toFixed(1)}%
                      {row.driftPoints != null && (
                        <span
                          className={
                            Math.abs(row.driftPoints) >= 10
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {' '}
                          ({row.driftPoints > 0 ? '+' : ''}
                          {row.driftPoints.toFixed(0)} pts)
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Look-through */}
      {lookThrough && lookThrough.top.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-5 w-5" />
              What your equity funds actually hold
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Every fund&apos;s disclosed holdings, weighted by the money you have in it. Resolves to{' '}
              {lookThrough.uniqueIssuers} companies, top 10 at{' '}
              {lookThrough.topTenPercent.toFixed(0)}%. Covers{' '}
              {lookThrough.coveragePercent.toFixed(0)}% of your equity money, and only the top 20
              holdings per fund are published — so true concentration is a little higher.
            </p>
          </CardHeader>
          <CardContent>
            <div style={{ height: Math.max(180, lookThrough.top.length * 28) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lookThrough.top} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" unit="%" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={160}
                    tick={{ fontSize: 11 }}
                    interval={0}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value.toFixed(1)}%`, 'Of your equity money']}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="percent" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Holdings */}
      {evaluation.holdings.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>Your holdings, ranked</CardTitle>
              <p className="text-xs text-muted-foreground">
                Ordered best to worst by peer standing. Selling costs exit load and capital gains
                tax, so a weak fund is only a switch when the gap is worth the cost.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {[...evaluation.holdings]
                .sort((a, b) => {
                  // Unranked rows last; otherwise best standing first.
                  if (a.rank === 0) return 1;
                  if (b.rank === 0) return -1;
                  return a.rank - b.rank;
                })
                .map((holding) => (
                  <HoldingRow
                    key={holding.holding.id}
                    evaluated={holding}
                    onRemove={onRemoveHolding}
                  />
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* SIPs */}
      {evaluation.sips.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>Your SIPs, ranked</CardTitle>
              <p className="text-xs text-muted-foreground">
                Judged on a lower bar than holdings: redirecting future instalments has no exit load,
                no tax and realises nothing.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {[...evaluation.sips]
                .sort((a, b) => {
                  if (a.rank === 0) return 1;
                  if (b.rank === 0) return -1;
                  return a.rank - b.rank;
                })
                .map((sip) => (
                  <SipRow key={sip.sip.id} evaluated={sip} onRemove={onRemoveSip} />
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overlap and concentration */}
      {(evaluation.overlapPairs.length > 0 || evaluation.amcConcentration.length > 1) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {evaluation.overlapPairs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funds holding the same things</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Weighted overlap — the sum of the smaller weight for every shared holding. Two
                  identical portfolios give 100.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {evaluation.overlapPairs.slice(0, 8).map((pair) => (
                  <div key={`${pair.aId}-${pair.bId}`} className="space-y-1.5">
                    <div className="flex justify-between gap-3 text-xs">
                      <span className="min-w-0">
                        {pair.aName} <span className="text-muted-foreground">and</span> {pair.bName}
                      </span>
                      <span className="font-semibold tabular-nums shrink-0">
                        {pair.percent.toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={pair.percent} className="h-1.5" />
                    {pair.combinedAmount != null && (
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(pair.combinedAmount)} across the pair
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {evaluation.amcConcentration.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where the money sits by fund house</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Schemes at one AMC often share a research desk and a house view, so they tend to
                  move together more than their categories suggest.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {evaluation.amcConcentration.slice(0, 8).map((row) => (
                  <div key={row.label} className="space-y-1.5">
                    <div className="flex justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate">{row.label}</span>
                      <span className="tabular-nums shrink-0">
                        {formatCurrency(row.amount)} · {row.percent.toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={row.percent} className="h-1.5" />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Data caveats */}
      {evaluation.notes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What these figures do not cover</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {evaluation.notes.map((note) => (
              <div key={note} className="flex gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{note}</span>
              </div>
            ))}
            <Separator className="my-2" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Every verdict here is arithmetic over published fund data and the figures you uploaded —
              peer percentiles, category averages, holdings overlap, exit load terms and the current
              capital gains rates. There is no forecast in it, and it is not advice. Break-even
              figures assume a trailing return gap persists, which is an assumption, not a
              prediction.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
