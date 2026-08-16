import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { NumericInput } from '@/components/ui/numeric-input';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ClipboardCheck,
  Info,
  Loader2,
  LogIn,
  Save,
  ShieldOff,
  Trash2,
} from 'lucide-react';

import { useMutualFunds } from '@/hooks/useMutualFunds';
import { useFundScores } from '@/hooks/useFundScores';
import { useHoldings } from '@/hooks/useHoldings';
import { useUserHoldings } from '@/hooks/useUserHoldings';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { HoldingsImporter } from '@/components/HoldingsImporter';
import { HoldingsEvaluationView } from '@/components/HoldingsEvaluationView';
import { evaluatePortfolio } from '@/utils/holdingsEvaluation';
import { ALLOCATION_PRESETS, type AssetAllocation } from '@/utils/assetClass';

/**
 * "What should I do with what I already own?"
 *
 * Deliberately a public route. Someone evaluating a portfolio has not committed
 * to anything yet, and putting a sign-in wall in front of the one page that shows
 * whether the tool is any use would be the wrong trade. Signing in buys exactly
 * one thing — the ability to save — and the page says so rather than implying more.
 */

/** Marginal slab rates as they appear in the Act, for the switch-cost figures. */
const SLAB_RATES = [0, 5, 20, 30] as const;

export default function Evaluate() {
  const { user, signInWithGoogle } = useAuth();
  const { toast } = useToast();

  const { isLoading: fundsLoading } = useMutualFunds();
  const { universe, context, isLoading: scoresLoading } = useFundScores();
  const { holdings: fundHoldings } = useHoldings();

  const {
    snapshot,
    setMfHoldings,
    setSipHoldings,
    removeMfHolding,
    removeSipHolding,
    clearAll,
    isEmpty,
    isDirty,
    canSave,
    hasSaved,
    savedAt,
    save,
    isSaving,
    loadSaved,
    deleteSaved,
    isDeleting,
    error,
  } = useUserHoldings();

  /*
   * Two inputs the evaluation cannot derive.
   *
   * The target split is a preference, not a fact, so it starts unset — reporting
   * "drift" against a target nobody chose would be inventing the benchmark and
   * then judging against it. The slab rate is genuinely unknowable from the data,
   * and the alternative to asking is either guessing 30% (wrong for most people)
   * or leaving every debt and hybrid switch cost blank.
   */
  const [targetAllocation, setTargetAllocation] = useState<AssetAllocation | undefined>(undefined);
  const [slabRate, setSlabRate] = useState<number | undefined>(undefined);
  const [exemptionHeadroom, setExemptionHeadroom] = useState<number>(125_000);

  const isLoading = fundsLoading || scoresLoading;

  const evaluation = useMemo(
    () =>
      evaluatePortfolio({
        mf: snapshot.mf,
        sips: snapshot.sips,
        universe,
        context,
        fundHoldings,
        targetAllocation,
        slabRatePercent: slabRate,
        exemptionHeadroomRupees: exemptionHeadroom,
      }),
    [snapshot, universe, context, fundHoldings, targetAllocation, slabRate, exemptionHeadroom],
  );

  const handleSave = async () => {
    try {
      await save();
      toast({
        title: 'Holdings saved',
        description: 'Stored against your account. Only you can read it.',
      });
    } catch {
      // The hook surfaces the message; the toast avoids a silent no-op.
      toast({
        title: 'Could not save',
        description: 'Check your connection and try again.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    await deleteSaved();
    toast({
      title: 'Saved copy deleted',
      description: 'Nothing of your portfolio remains on the server.',
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            Evaluate Holdings
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Upload what you hold and what you are adding to each month, and this ranks every fund
            against its own sub-category, finds the ones that hold the same stocks as each other, and
            works out what leaving each position would actually cost in exit load and capital gains
            tax. Arithmetic over published data and your own figures — no forecast, and not advice.
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Storage state. Stated up front, because "nothing is stored" is a
              promise the user has to be able to rely on. */}
          <div
            className={`rounded-lg border p-3.5 text-xs flex flex-wrap items-center justify-between gap-3 ${
              canSave ? 'border-border bg-muted/30' : 'border-amber-300/50 bg-amber-50/50 dark:bg-amber-900/10'
            }`}
          >
            <div className="flex gap-2 min-w-0">
              {canSave ? (
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <ShieldOff className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5 min-w-0">
                {canSave ? (
                  <>
                    <p className="font-medium">
                      {isDirty
                        ? 'Unsaved. This stays in the browser tab until you save it.'
                        : hasSaved
                          ? 'Saved to your account.'
                          : 'Nothing saved yet.'}
                    </p>
                    <p className="text-muted-foreground">
                      Saving stores one document against your account that only you can read.
                      {savedAt && <> Last saved {new Date(savedAt).toLocaleString('en-IN')}.</>}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Nothing here is stored anywhere.</p>
                    <p className="text-muted-foreground">
                      Not on the server, and not in browser storage either — refreshing this page
                      clears it and you would upload the file again. Sign in if you want to keep it.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!canSave && (
                <Button variant="outline" size="sm" onClick={() => void signInWithGoogle()}>
                  <LogIn className="h-3.5 w-3.5 mr-1.5" />
                  Sign in to save
                </Button>
              )}

              {canSave && (
                <Button size="sm" disabled={isEmpty || !isDirty || isSaving} onClick={handleSave}>
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Save
                </Button>
              )}

              {canSave && hasSaved && (
                <Button variant="ghost" size="sm" onClick={loadSaved}>
                  Load saved copy
                </Button>
              )}

              {!isEmpty && (
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Clear
                </Button>
              )}

              {canSave && hasSaved && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-loss" disabled={isDeleting}>
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete saved
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete the saved copy?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the holdings document stored against your account.
                        The list on screen is cleared too, and this cannot be undone — you would need
                        to upload your file again.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleDelete()}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-loss">{error}</p>}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading the fund universe…</p>
          ) : (
            <HoldingsImporter
              universe={universe}
              mfCount={snapshot.mf.length}
              sipCount={snapshot.sips.length}
              onMfImported={setMfHoldings}
              onSipImported={setSipHoldings}
            />
          )}

          {!isEmpty && (
            <>
              <Separator />

              <div className="space-y-4">
                <div>
                  <h3 className="font-medium text-sm">Two things the data cannot tell us</h3>
                  <p className="text-xs text-muted-foreground">
                    Both are optional. Without them the relevant figures are withheld rather than
                    guessed.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-xs">Target asset split, to measure drift against</Label>
                    <div className="flex flex-wrap gap-2">
                      {ALLOCATION_PRESETS.map((preset) => (
                        <Badge
                          key={preset.id}
                          variant={targetAllocation === preset.allocation ? 'default' : 'outline'}
                          className="cursor-pointer"
                          title={preset.description}
                          onClick={() => setTargetAllocation(preset.allocation)}
                        >
                          {preset.label}
                        </Badge>
                      ))}
                      {targetAllocation && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground"
                          onClick={() => setTargetAllocation(undefined)}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {targetAllocation
                        ? 'Your actual mix is compared against this. Drift is corrected more cheaply with new money than by selling.'
                        : 'Unset, so only your actual mix is shown. Picking a target is what turns it into drift.'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Your marginal income tax rate</Label>
                    <div className="flex flex-wrap gap-2">
                      {SLAB_RATES.map((rate) => (
                        <Badge
                          key={rate}
                          variant={slabRate === rate ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => setSlabRate(rate)}
                        >
                          {rate}%
                        </Badge>
                      ))}
                      {slabRate != null && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground"
                          onClick={() => setSlabRate(undefined)}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Debt and hybrid gains are taxed at your slab rate rather than a flat one, so
                      without this the cost of switching those funds is shown as unknown instead of
                      assumed.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="exemption" className="text-xs">
                      Long-term capital gains exemption left this year
                    </Label>
                    <NumericInput
                      id="exemption"
                      min={0}
                      step={25_000}
                      value={exemptionHeadroom}
                      emptyValue={0}
                      onValueChange={(next) => setExemptionHeadroom(next ?? 0)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Equity long-term gains get an annual per-PAN exemption. If you have already
                      realised gains this year, lower this — otherwise the cost of switching is
                      understated.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {isEmpty ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Upload a holdings or SIP CSV above to see the analysis.
            </p>
            <p className="text-xs text-muted-foreground">
              Either file on its own is enough. Column names are matched loosely, so most broker and
              registrar exports work as-is — and the template shows a file that definitely does.
            </p>
          </CardContent>
        </Card>
      ) : (
        <HoldingsEvaluationView
          evaluation={evaluation}
          onRemoveHolding={removeMfHolding}
          onRemoveSip={removeSipHolding}
        />
      )}
    </div>
  );
}
