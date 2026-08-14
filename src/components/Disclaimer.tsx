import { AlertTriangle } from 'lucide-react';
import { getLoadedDatasetGeneratedAt } from '@/services/firebaseService';

/**
 * Site-wide disclaimer.
 *
 * This app ranks named mutual funds and shows post-tax figures. In India,
 * offering fund-specific investment advice is regulated activity requiring SEBI
 * registration, so it needs to be unambiguous that what is on screen is a
 * screen over public data rather than a recommendation.
 *
 * Data age is shown alongside it because a stale ranking presented without a
 * date reads as current, which is its own kind of misleading.
 */
export function Disclaimer() {
  const generatedAt = getLoadedDatasetGeneratedAt();

  const asOf = generatedAt
    ? new Date(generatedAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <footer className="border-t border-border mt-8 px-4 md:px-8 py-6 text-xs text-muted-foreground space-y-2">
      <div className="flex gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          <strong className="text-foreground">Not investment advice.</strong> Fund Guru is a
          screening tool over publicly available data. It is not SEBI-registered as an Investment
          Adviser or Research Analyst, and nothing here is a recommendation to buy, sell, hold, or
          continue any scheme. Rankings are arithmetic over historical figures — past performance
          does not indicate future returns. Consult a SEBI-registered adviser and read the scheme
          information document before investing.
        </p>
      </div>
      <p className="pl-6">
        Tax figures are illustrative and change with every Union Budget; verify against
        incometax.gov.in. Fund data is sourced from a third-party public API and may be incomplete,
        delayed, or wrong. Only currently open direct plans are covered, so historical comparisons
        carry survivorship bias.
        {asOf && <> Data as of {asOf}.</>}
      </p>
    </footer>
  );
}
