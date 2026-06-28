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

  const handleChange = (category: keyof ScoringWeights, field: string | null, value: string) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;

    if (field) {
      setLocalWeights((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [category]: {
            ...(prev[category] as any),
            [field]: numValue,
          },
        };
      });
    } else {
      setLocalWeights((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [category]: numValue,
        };
      });
    }
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

  // Helper to calculate total weights to ensure they sum to roughly 1.0 (100%)
  const totalBaseWeight = 
    localWeights.returns.sixMonth + 
    localWeights.returns.oneYear + 
    localWeights.returns.threeYear + 
    localWeights.returns.fiveYear +
    localWeights.expenseRatio +
    localWeights.sharpeRatio +
    localWeights.sortinoRatio +
    localWeights.alpha +
    localWeights.informationRatio;
  
  const isBalanced = Math.abs(totalBaseWeight - 1.0) < 0.01;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="h-5 w-5" />
          AI Scoring Weights
        </CardTitle>
        <CardDescription>
          Adjust the multipliers used to calculate the AI Score for each mutual fund.
          These take effect immediately across all clients. (Recommended total sum: 1.0)
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
                  onChange={(e) => handleChange('returns', 'sixMonth', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>1 Year Return</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.returns.oneYear} 
                  onChange={(e) => handleChange('returns', 'oneYear', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>3 Year Return</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.returns.threeYear} 
                  onChange={(e) => handleChange('returns', 'threeYear', e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>5 Year Return</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.returns.fiveYear} 
                  onChange={(e) => handleChange('returns', 'fiveYear', e.target.value)} 
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
                  onChange={(e) => handleChange('expenseRatio', null, e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Sharpe Ratio</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.sharpeRatio} 
                  onChange={(e) => handleChange('sharpeRatio', null, e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Sortino Ratio</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.sortinoRatio} 
                  onChange={(e) => handleChange('sortinoRatio', null, e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Alpha</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.alpha} 
                  onChange={(e) => handleChange('alpha', null, e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Information Ratio</Label>
                <Input 
                  type="number" 
                  step="0.05"
                  value={localWeights.informationRatio} 
                  onChange={(e) => handleChange('informationRatio', null, e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>Base Risk Penalty</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={localWeights.riskAdjustment} 
                  onChange={(e) => handleChange('riskAdjustment', null, e.target.value)} 
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
