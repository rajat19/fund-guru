import { useState, useEffect } from 'react';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import { ScoringWeights } from '@/utils/scoringEngine';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Settings2, Save } from 'lucide-react';

export function ScoringConfigSection() {
  const { weights, updateWeights, isUpdating, isLoading } = useScoringConfig();
  const [localWeights, setLocalWeights] = useState<ScoringWeights | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (weights) {
      setLocalWeights(weights);
    }
  }, [weights]);

  if (isLoading || !localWeights) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  /** Scalar weights live at the top level; return weights are nested one deep. */
  type ScalarWeightKey = Exclude<keyof ScoringWeights, 'returns'>;
  type ReturnWeightKey = keyof ScoringWeights['returns'];

  const handleScalarChange = (key: ScalarWeightKey, value: string) => {
    const numValue = parseFloat(value);
    if (Number.isNaN(numValue)) return;
    setLocalWeights((prev) => (prev ? { ...prev, [key]: numValue } : prev));
  };

  const handleReturnChange = (key: ReturnWeightKey, value: string) => {
    const numValue = parseFloat(value);
    if (Number.isNaN(numValue)) return;
    setLocalWeights((prev) =>
      prev ? { ...prev, returns: { ...prev.returns, [key]: numValue } } : prev,
    );
  };

  const handleSave = async () => {
    if (!localWeights) return;
    try {
      await updateWeights(localWeights);
      toast({
        title: 'Settings Saved',
        description: 'AI Scoring weights have been updated globally.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save configuration.',
        variant: 'destructive',
      });
    }
  };

  // Every metric is a 0-100 percentile, so weights summing to 1.0 make the
  // score itself a 0-100 number. riskAdjustment is excluded on purpose: it is a
  // multiplier applied after the weighted sum, not one of the inputs.
  const totalBaseWeight =
    localWeights.returns.sixMonth +
    localWeights.returns.oneYear +
    localWeights.returns.threeYear +
    localWeights.returns.fiveYear +
    localWeights.expenseRatio +
    localWeights.sharpeRatio +
    localWeights.sortinoRatio +
    localWeights.alpha +
    localWeights.informationRatio +
    localWeights.categoryOutperformance +
    localWeights.consistency;

  const isBalanced = Math.abs(totalBaseWeight - 1.0) < 0.01;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="h-5 w-5" />
          Peer Score Weights
        </CardTitle>
        <CardDescription>
          Each metric is scored as a percentile within the fund&apos;s own sub-category, then
          combined using these weights. Keep the total at 1.00 so the output stays on a 0-100
          scale — a weight of 0.20 then means that metric is 20% of the score. Changes take
          effect immediately across all clients.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Returns Section */}
          <div className="space-y-4">
            <h3 className="font-medium border-b pb-2">Returns Importance</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>6 Month Return</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.returns.sixMonth} 
                  onChange={(e) => handleReturnChange('sixMonth', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>1 Year Return</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.returns.oneYear} 
                  onChange={(e) => handleReturnChange('oneYear', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>3 Year Return</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.returns.threeYear} 
                  onChange={(e) => handleReturnChange('threeYear', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>5 Year Return</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.returns.fiveYear} 
                  onChange={(e) => handleReturnChange('fiveYear', e.target.value)} 
                />
              </div>
            </div>
          </div>

          {/* Metrics Section */}
          <div className="space-y-4">
            <h3 className="font-medium border-b pb-2">Risk & Metrics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Expense Ratio</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.expenseRatio} 
                  onChange={(e) => handleScalarChange('expenseRatio', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Sharpe Ratio</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.sharpeRatio} 
                  onChange={(e) => handleScalarChange('sharpeRatio', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Sortino Ratio</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.sortinoRatio} 
                  onChange={(e) => handleScalarChange('sortinoRatio', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Alpha</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.alpha} 
                  onChange={(e) => handleScalarChange('alpha', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Information Ratio</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.informationRatio} 
                  onChange={(e) => handleScalarChange('informationRatio', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Beat Category</Label>
                <Input
                  type="number"
                  step="0.05"
                  value={localWeights.categoryOutperformance}
                  onChange={(e) => handleScalarChange('categoryOutperformance', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Rank Consistency</Label>
                <Input
                  type="number"
                  step="0.05"
                  value={localWeights.consistency}
                  onChange={(e) => handleScalarChange('consistency', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Risk Tilt (± multiplier)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={localWeights.riskAdjustment}
                  onChange={(e) => handleScalarChange('riskAdjustment', e.target.value)} 
                />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center bg-muted/20 border-t px-6 py-4">
        <div className="text-sm">
          Total Multiplier Sum:{' '}
          <span className={`font-mono font-bold ${isBalanced ? 'text-green-600' : 'text-orange-500'}`}>
            {totalBaseWeight.toFixed(2)}
          </span>
          {!isBalanced && <span className="ml-2 text-muted-foreground">(Recommended: 1.00)</span>}
        </div>
        <Button onClick={handleSave} disabled={isUpdating} className="gap-2">
          {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Configuration
        </Button>
      </CardFooter>
    </Card>
  );
}
