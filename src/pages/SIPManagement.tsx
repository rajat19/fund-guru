import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit2, Trash2, Play, Pause, Calendar, DollarSign, TrendingUp } from 'lucide-react';
import { useMutualFunds, useFundById } from '@/hooks/useMutualFunds';

interface SIP {
  id: string;
  fundId: string;
  fundName: string;
  amount: number;
  frequency: 'Monthly' | 'Quarterly' | 'Yearly';
  startDate: string;
  status: 'Active' | 'Paused' | 'Stopped';
  investedAmount: number;
  currentValue: number;
  returns: number;
}

export default function SIPManagement() {
  const { toast } = useToast();
  const { data: allFunds = [], isLoading: fundsLoading } = useMutualFunds();
  const [sips, setSips] = useState<SIP[]>([
    {
      id: '1',
      fundId: 'MF001',
      fundName: 'Axis Bluechip Fund',
      amount: 5000,
      frequency: 'Monthly',
      startDate: '2023-01-15',
      status: 'Active',
      investedAmount: 60000,
      currentValue: 72500,
      returns: 20.83,
    },
    {
      id: '2',
      fundId: 'MF005',
      fundName: 'Mirae Asset Large Cap Fund',
      amount: 3000,
      frequency: 'Monthly',
      startDate: '2023-03-10',
      status: 'Active',
      investedAmount: 33000,
      currentValue: 38200,
      returns: 15.76,
    },
    {
      id: '3',
      fundId: 'MF008',
      fundName: 'Parag Parikh Flexi Cap Fund',
      amount: 2000,
      frequency: 'Monthly',
      startDate: '2023-06-01',
      status: 'Paused',
      investedAmount: 16000,
      currentValue: 18300,
      returns: 14.38,
    },
  ]);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newSIP, setNewSIP] = useState({
    fundId: '',
    amount: '',
    frequency: 'Monthly',
    startDate: '',
  });

  const handleAddSIP = () => {
    if (!newSIP.fundId || !newSIP.amount || !newSIP.startDate) {
      toast({
        title: 'Error',
        description: 'Please fill all required fields.',
        variant: 'destructive',
      });
      return;
    }

    const fund = allFunds.find((f) => f.id === newSIP.fundId);
    if (!fund) return;

    const sip: SIP = {
      id: Date.now().toString(),
      fundId: newSIP.fundId,
      fundName: fund.schemeName,
      amount: parseInt(newSIP.amount),
      frequency: newSIP.frequency as 'Monthly' | 'Quarterly' | 'Yearly',
      startDate: newSIP.startDate,
      status: 'Active',
      investedAmount: 0,
      currentValue: 0,
      returns: 0,
    };

    setSips((prev) => [...prev, sip]);
    setNewSIP({ fundId: '', amount: '', frequency: 'Monthly', startDate: '' });
    setIsAddDialogOpen(false);

    toast({
      title: 'SIP Added',
      description: `SIP for ${fund.schemeName} has been successfully created.`,
    });
  };

  const toggleSIPStatus = (id: string) => {
    setSips((prev) =>
      prev.map((sip) =>
        sip.id === id ? { ...sip, status: sip.status === 'Active' ? 'Paused' : 'Active' } : sip,
      ),
    );
  };

  const deleteSIP = (id: string) => {
    setSips((prev) => prev.filter((sip) => sip.id !== id));
    toast({
      title: 'SIP Deleted',
      description: 'SIP has been successfully deleted.',
    });
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'Active':
        return 'default';
      case 'Paused':
        return 'secondary';
      case 'Stopped':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const totalInvested = sips.reduce((sum, sip) => sum + sip.investedAmount, 0);
  const totalCurrentValue = sips.reduce((sum, sip) => sum + sip.currentValue, 0);
  const totalReturns = totalCurrentValue - totalInvested;
  const totalReturnPercentage = totalInvested > 0 ? (totalReturns / totalInvested) * 100 : 0;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">SIP Management</h1>
          <p className="text-muted-foreground">Manage your systematic investment plans</p>
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add New SIP
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New SIP</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="fund">Select Fund</Label>
                <Select
                  value={newSIP.fundId}
                  onValueChange={(value) => setNewSIP((prev) => ({ ...prev, fundId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a mutual fund" />
                  </SelectTrigger>
                  <SelectContent>
                    {fundsLoading ? (
                      <SelectItem value="" disabled>Loading funds...</SelectItem>
                    ) : (
                      allFunds.map((fund) => (
                        <SelectItem key={fund.id} value={fund.id}>
                          {fund.schemeName}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="amount">SIP Amount (₹)</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder="5000"
                  value={newSIP.amount}
                  onChange={(e) => setNewSIP((prev) => ({ ...prev, amount: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="frequency">Frequency</Label>
                <Select
                  value={newSIP.frequency}
                  onValueChange={(value) => setNewSIP((prev) => ({ ...prev, frequency: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Quarterly">Quarterly</SelectItem>
                    <SelectItem value="Yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={newSIP.startDate}
                  onChange={(e) => setNewSIP((prev) => ({ ...prev, startDate: e.target.value }))}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleAddSIP} className="flex-1">
                  Create SIP
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsAddDialogOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">₹{totalInvested.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Invested</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold text-profit">
                  ₹{totalCurrentValue.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Current Value</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold text-profit">
                  +₹{totalReturns.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Total Returns</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">
                  {sips.filter((sip) => sip.status === 'Active').length}
                </div>
                <div className="text-sm text-muted-foreground">Active SIPs</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SIP List */}
      <Card>
        <CardHeader>
          <CardTitle>Your SIPs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sips.map((sip) => (
              <div key={sip.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{sip.fundName}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-3">
                      <div>
                        <div className="text-sm text-muted-foreground">Amount</div>
                        <div className="font-semibold">₹{sip.amount.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Frequency</div>
                        <div className="font-semibold">{sip.frequency}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Invested</div>
                        <div className="font-semibold">₹{sip.investedAmount.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Current Value</div>
                        <div className="font-semibold text-profit">
                          ₹{sip.currentValue.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Returns</div>
                        <div className="font-semibold text-profit">+{sip.returns.toFixed(2)}%</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Badge variant={getStatusBadgeVariant(sip.status)}>{sip.status}</Badge>
                    <Button variant="outline" size="icon" onClick={() => toggleSIPStatus(sip.id)}>
                      {sip.status === 'Active' ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => deleteSIP(sip.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {sips.length === 0 && (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  No SIPs found. Create your first SIP to get started.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
