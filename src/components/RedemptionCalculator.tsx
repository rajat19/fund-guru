import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Calculator, Info } from 'lucide-react';
import { MutualFund } from '@/types/mutualFund';
import { projectRedemption, returnBasisFor } from '@/utils/taxation';
import { describeExitLoad, exitLoadPolicyFor } from '@/utils/exitLoad';
import { formatCurrency, formatPercent } from '@/utils/format';

interface RedemptionCalculatorProps {
  fund: MutualFund;
}

const PRESET_AMOUNTS = [100_000, 500_000, 1_000_000];

/** Renders the holding period as "2 yr 6 mo" rather than "30". */
const describeMonths = (months: number): string => {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${months} month${months === 1 ? '' : 's'}`;
  if (rest === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years}y ${rest}m`;
};

/**
 * "What would I actually keep?" for a single lump sum.
 *
 * Deliberately does NOT subtract the expense ratio from the projected return.
 * TER is deducted from NAV daily, so it is already inside every trailing return
 * this projects from — subtracting it again would double-count. It is instead
 * shown as a separate counterfactual line, which is the honest way to express
 * what it costs.
 */
export function RedemptionCalculator({ fund }: RedemptionCalculatorProps) {
  const [amount, setAmount] = useState(100_000);
  const [months, setMonths] = useState(36);
  const [slabRate, setSlabRate] = useState<number | undefined>(undefined);

  const policy = useMemo(() => exitLoadPolicyFor(fund), [fund]);

  // Independent of the amount: tells us whether the fund is projectable at all.
  const basis = useMemo(() => returnBasisFor(fund, months), [fund, months]);

  const projection = useMemo(
    () =>
      projectRedemption(fund, {
        amountRupees: amount,
        holdingMonths: months,
        slabRatePercent: slabRate,
      }),
    [fund, amount, months, slabRate],
  );

  /*
   * Two distinct reasons there may be nothing to show, and they must not share a
   * message. No return history is a property of the fund and nothing the user can
   * fix here. An empty amount box is transient — and critically, the card must
   * keep rendering its inputs in that case, or clearing the field would remove
   * the very box needed to type a new value into.
   */
  if (!basis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Redemption calculator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This fund has no annualised return history yet, so there is nothing to project from.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Waterfall rows. Deductions are negative and rendered in the loss colour.
  const rows: Array<{ label: string; value: number | null; kind: 'add' | 'deduct' | 'total' }> =
    projection
      ? [
          { label: 'Invested', value: projection.invested, kind: 'add' },
          {
            label: `Growth at ${basis.label} CAGR of ${formatPercent(basis.annualPercent)}`,
            value: projection.grossGain,
            kind: 'add',
          },
          { label: 'Value before costs', value: projection.grossValue, kind: 'total' },
          {
            label:
              projection.exitLoad.ratePercent > 0
                ? `Exit load (${projection.exitLoad.ratePercent}% on ${(projection.exitLoad.chargeableFraction * 100).toFixed(0)}%)`
                : 'Exit load',
            value: -projection.exitLoadAmount,
            kind: 'deduct',
          },
          {
            label:
              projection.effectiveTaxRatePercent != null
                ? `Capital gains tax (${projection.isLongTerm ? 'long' : 'short'}-term, ${formatPercent(projection.effectiveTaxRatePercent)})`
                : 'Capital gains tax (needs your slab rate)',
            value: projection.taxAmount === null ? null : -projection.taxAmount,
            kind: 'deduct',
          },
          { label: 'You keep', value: projection.netValue, kind: 'total' },
        ]
      : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Redemption calculator
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          What a lump sum would be worth after exit load and capital gains tax, if this fund
          repeated its {basis.label} CAGR. An illustration, not a forecast.
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Amount */}
        <div className="space-y-2">
          <Label htmlFor="redemption-amount">Amount invested</Label>
          <div className="flex flex-wrap items-center gap-2">
            <NumericInput
              id="redemption-amount"
              min={0}
              step={10000}
              value={amount}
              // Empty means zero invested; the card then prompts for an amount
              // instead of rendering a waterfall of zeros.
              emptyValue={0}
              onValueChange={(next) => setAmount(next ?? 0)}
              className="w-40"
            />
            {PRESET_AMOUNTS.map((preset) => (
              <Badge
                key={preset}
                variant={amount === preset ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => setAmount(preset)}
              >
                {formatCurrency(preset)}
              </Badge>
            ))}
          </div>
        </div>

        {/* Holding period */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <Label htmlFor="holding-period">Redeem after</Label>
            <span className="text-sm font-semibold">{describeMonths(months)}</span>
          </div>
          <Slider
            id="holding-period"
            min={1}
            max={120}
            step={1}
            value={[months]}
            onValueChange={([next]) => setMonths(next)}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1 mo</span>
            <span>5 yr</span>
            <span>10 yr</span>
          </div>
        </div>

        {/* Slab rate — only asked for when it changes the answer */}
        {projection?.taxAmount === null && (
          <div className="space-y-2">
            <Label htmlFor="slab-rate">Your marginal slab rate (%)</Label>
            <NumericInput
              id="slab-rate"
              min={0}
              max={45}
              step={5}
              placeholder="e.g. 30"
              value={slabRate}
              // Empty means "not specified" here, not 0% tax — passing 0 through
              // would silently compute a tax-free outcome for a slab-taxed fund.
              onValueChange={setSlabRate}
              className="w-32"
            />
          </div>
        )}

        {/* Waterfall, or a prompt when there is no amount to divide */}
        {!projection ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-center text-muted-foreground">
            Enter an amount to see what you would keep after exit load and tax.
          </p>
        ) : (
        <div className="rounded-lg border border-border divide-y divide-border">
          {rows.map((row) => (
            <div
              key={row.label}
              className={`flex justify-between items-center gap-4 px-4 py-2.5 ${
                row.kind === 'total' ? 'bg-muted/40 font-semibold' : ''
              }`}
            >
              <span className="text-sm">{row.label}</span>
              <span
                className={`text-sm font-mono tabular-nums ${
                  row.value === null
                    ? 'text-muted-foreground'
                    : row.kind === 'deduct' && row.value !== 0
                      ? 'text-loss'
                      : ''
                }`}
              >
                {row.value === null ? '—' : formatCurrency(row.value)}
              </span>
            </div>
          ))}
        </div>
        )}

        {/* Headline outcome */}
        {projection && projection.netGain !== null && projection.netCagrPercent !== null && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Net gain</div>
              <div className="text-lg font-semibold">{formatCurrency(projection.netGain)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Net CAGR after tax &amp; load</div>
              <div className="text-lg font-semibold">
                {formatPercent(projection.netCagrPercent)}
              </div>
            </div>
          </div>
        )}

        {/* Expense ratio: context, never a deduction */}
        {projection && projection.terDragAmount !== null && projection.terDragAmount > 0 && (
          <div className="rounded-lg bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex gap-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              The {formatPercent(fund.expenseRatio)} expense ratio is{' '}
              <strong className="text-foreground">already deducted</strong> from the returns above —
              it comes out of NAV daily, so it is not a separate charge. Had this fund been free,
              the same holding would have reached roughly{' '}
              <strong className="text-foreground">
                {formatCurrency(projection.grossValue + projection.terDragAmount)}
              </strong>{' '}
              instead of {formatCurrency(projection.grossValue)}, so the fee cost about{' '}
              <strong className="text-foreground">
                {formatCurrency(projection.terDragAmount)}
              </strong>{' '}
              over {describeMonths(months)}.
            </span>
          </div>
        )}

        {/* Exit load terms as stated by the AMC */}
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            <span className="font-medium text-foreground">Exit load:</span>{' '}
            {describeExitLoad(policy)}
            {policy.raw && policy.kind !== 'none' && (
              <span className="block mt-0.5 italic">&ldquo;{policy.raw}&rdquo;</span>
            )}
          </div>
        </div>

        {projection && projection.notes.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
            {projection.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          Single lump sum only — a real SIP has a separate holding period per instalment. Tax rates
          are illustrative; verify against incometax.gov.in. Not tax or investment advice.
        </p>
      </CardContent>
    </Card>
  );
}
