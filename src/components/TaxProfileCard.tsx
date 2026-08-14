import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Receipt, Info } from 'lucide-react';
import { MutualFund } from '@/types/mutualFund';
import { postTaxReturnSeries, slabArbitrageApplies, taxProfile } from '@/utils/taxation';
import { formatPercent, formatReturn } from '@/utils/format';

const BUCKET_STYLES: Record<string, string> = {
  equity: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  debt: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  hybrid: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  commodity: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  international: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
  unknown: 'bg-muted text-muted-foreground',
};

interface TaxProfileCardProps {
  fund: MutualFund;
  /**
   * Marginal slab rate in percent. Slab-taxed buckets cannot show a post-tax
   * figure without it, and we would rather show nothing than assume 30%.
   */
  slabRatePercent?: number;
}

export function TaxProfileCard({ fund, slabRatePercent }: TaxProfileCardProps) {
  const profile = taxProfile(fund);
  const { rules } = profile;
  const postTax = postTaxReturnSeries(fund, slabRatePercent);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Tax treatment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={BUCKET_STYLES[profile.bucket]}>
            {rules.label}
          </Badge>
          {profile.equityPercentage != null && (
            <span className="text-xs text-muted-foreground">
              {formatPercent(profile.equityPercentage, 1)} equity
            </span>
          )}
          {!profile.fromAllocation && (
            <span className="text-xs text-muted-foreground">
              (classified by scheme type, not allocation)
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Long-term after</div>
            <div className="font-semibold">
              {rules.longTermAfterMonths == null
                ? 'Never — always slab'
                : `${rules.longTermAfterMonths} months`}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Long-term rate</div>
            <div className="font-semibold">
              {rules.longTermRatePercent == null
                ? 'Your slab rate'
                : `${rules.longTermRatePercent}%`}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Short-term rate</div>
            <div className="font-semibold">
              {rules.shortTermRatePercent == null
                ? 'Your slab rate'
                : `${rules.shortTermRatePercent}%`}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Annual exemption</div>
            <div className="font-semibold">
              {rules.longTermExemptionRupees > 0
                ? `₹${rules.longTermExemptionRupees.toLocaleString('en-IN')} per PAN`
                : 'None'}
            </div>
          </div>
        </div>

        {/* Post-tax returns, only when we can compute them honestly. */}
        {(postTax.oneYear != null || postTax.threeYear != null || postTax.fiveYear != null) && (
          <div className="pt-3 border-t border-border">
            <div className="text-xs text-muted-foreground mb-2">
              Approximate post-tax return (single lot, sold at the end of the period)
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {(
                [
                  ['1Y', fund.returns.oneYear, postTax.oneYear],
                  ['3Y', fund.returns.threeYear, postTax.threeYear],
                  ['5Y', fund.returns.fiveYear, postTax.fiveYear],
                ] as const
              ).map(([label, gross, net]) => (
                <div key={label}>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="font-semibold">{formatReturn(net)}</div>
                  <div className="text-xs text-muted-foreground line-through">
                    {formatReturn(gross)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {slabRatePercent == null && slabArbitrageApplies(fund) && (
          <p className="text-xs text-muted-foreground flex gap-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Gains in this bucket are taxed at your slab rate, so a post-tax figure needs your
            marginal rate. Set it in your profile to see one.
          </p>
        )}

        <p className="text-xs text-muted-foreground">{rules.note}</p>

        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          Rates shown follow the {profile.regimeLabel} and are for illustration only. Verify
          against incometax.gov.in — they change with every Union Budget. Not tax advice.
        </p>
      </CardContent>
    </Card>
  );
}
