import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Target, Plus, Calendar, DollarSign, TrendingUp, Home, Car, GraduationCap, Plane } from 'lucide-react';

interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  category: 'Retirement' | 'Education' | 'House' | 'Travel' | 'Emergency' | 'Other';
  monthlyContribution: number;
  status: 'On Track' | 'Behind' | 'Achieved';
}

const goalIcons = {
  'Retirement': Target,
  'Education': GraduationCap,
  'House': Home,
  'Travel': Plane,
  'Emergency': DollarSign,
  'Other': Target
};

export default function Goals() {
  const { toast } = useToast();
  const [goals, setGoals] = useState<Goal[]>([
    {
      id: '1',
      name: 'Retirement Fund',
      targetAmount: 10000000,
      currentAmount: 245000,
      targetDate: '2055-12-31',
      category: 'Retirement',
      monthlyContribution: 25000,
      status: 'On Track'
    },
    {
      id: '2',
      name: 'Child Education',
      targetAmount: 2500000,
      currentAmount: 180000,
      targetDate: '2035-06-15',
      category: 'Education',
      monthlyContribution: 15000,
      status: 'On Track'
    },
    {
      id: '3',
      name: 'Dream House',
      targetAmount: 5000000,
      currentAmount: 650000,
      targetDate: '2030-03-31',
      category: 'House',
      monthlyContribution: 35000,
      status: 'Behind'
    },
    {
      id: '4',
      name: 'Emergency Fund',
      targetAmount: 600000,
      currentAmount: 485000,
      targetDate: '2025-12-31',
      category: 'Emergency',
      monthlyContribution: 8000,
      status: 'On Track'
    }
  ]);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newGoal, setNewGoal] = useState({
    name: '',
    targetAmount: '',
    targetDate: '',
    category: 'Other',
    monthlyContribution: ''
  });

  const handleAddGoal = () => {
    if (!newGoal.name || !newGoal.targetAmount || !newGoal.targetDate || !newGoal.monthlyContribution) {
      toast({
        title: "Error",
        description: "Please fill all required fields.",
        variant: "destructive"
      });
      return;
    }

    const goal: Goal = {
      id: Date.now().toString(),
      name: newGoal.name,
      targetAmount: parseInt(newGoal.targetAmount),
      currentAmount: 0,
      targetDate: newGoal.targetDate,
      category: newGoal.category as Goal['category'],
      monthlyContribution: parseInt(newGoal.monthlyContribution),
      status: 'On Track'
    };

    setGoals(prev => [...prev, goal]);
    setNewGoal({ name: '', targetAmount: '', targetDate: '', category: 'Other', monthlyContribution: '' });
    setIsAddDialogOpen(false);
    
    toast({
      title: "Goal Added",
      description: `Financial goal "${goal.name}" has been successfully created.`,
    });
  };

  const calculateProgress = (current: number, target: number) => {
    return Math.min((current / target) * 100, 100);
  };

  const calculateMonthsRemaining = (targetDate: string) => {
    const today = new Date();
    const target = new Date(targetDate);
    const diffTime = target.getTime() - today.getTime();
    const diffMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30));
    return Math.max(diffMonths, 0);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'On Track': return 'default';
      case 'Behind': return 'destructive';
      case 'Achieved': return 'secondary';
      default: return 'outline';
    }
  };

  const totalTargetAmount = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
  const totalCurrentAmount = goals.reduce((sum, goal) => sum + goal.currentAmount, 0);
  const totalMonthlyContribution = goals.reduce((sum, goal) => sum + goal.monthlyContribution, 0);
  const overallProgress = (totalCurrentAmount / totalTargetAmount) * 100;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Financial Goals</h1>
          <p className="text-muted-foreground">Track and manage your investment objectives</p>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add New Goal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Financial Goal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="goalName">Goal Name</Label>
                <Input 
                  id="goalName"
                  placeholder="e.g., Vacation to Europe"
                  value={newGoal.name}
                  onChange={(e) => setNewGoal(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="category">Category</Label>
                <Select value={newGoal.category} onValueChange={(value) => setNewGoal(prev => ({ ...prev, category: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Retirement">Retirement</SelectItem>
                    <SelectItem value="Education">Education</SelectItem>
                    <SelectItem value="House">House</SelectItem>
                    <SelectItem value="Travel">Travel</SelectItem>
                    <SelectItem value="Emergency">Emergency</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="targetAmount">Target Amount (₹)</Label>
                <Input 
                  id="targetAmount"
                  type="number"
                  placeholder="500000"
                  value={newGoal.targetAmount}
                  onChange={(e) => setNewGoal(prev => ({ ...prev, targetAmount: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="targetDate">Target Date</Label>
                <Input 
                  id="targetDate"
                  type="date"
                  value={newGoal.targetDate}
                  onChange={(e) => setNewGoal(prev => ({ ...prev, targetDate: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="monthlyContribution">Monthly Contribution (₹)</Label>
                <Input 
                  id="monthlyContribution"
                  type="number"
                  placeholder="10000"
                  value={newGoal.monthlyContribution}
                  onChange={(e) => setNewGoal(prev => ({ ...prev, monthlyContribution: e.target.value }))}
                />
              </div>
              
              <div className="flex gap-2 pt-4">
                <Button onClick={handleAddGoal} className="flex-1">Create Goal</Button>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="flex-1">Cancel</Button>
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
              <Target className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">₹{(totalTargetAmount / 10000000).toFixed(1)}Cr</div>
                <div className="text-sm text-muted-foreground">Total Target</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold text-profit">₹{totalCurrentAmount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Current Progress</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">₹{totalMonthlyContribution.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Monthly Investment</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">{overallProgress.toFixed(1)}%</div>
                <div className="text-sm text-muted-foreground">Overall Progress</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Goals List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {goals.map(goal => {
          const IconComponent = goalIcons[goal.category];
          const progress = calculateProgress(goal.currentAmount, goal.targetAmount);
          const monthsRemaining = calculateMonthsRemaining(goal.targetDate);
          const yearsRemaining = Math.floor(monthsRemaining / 12);
          const remainingMonths = monthsRemaining % 12;
          
          return (
            <Card key={goal.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <IconComponent className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{goal.name}</CardTitle>
                      <Badge variant="outline">{goal.category}</Badge>
                    </div>
                  </div>
                  <Badge variant={getStatusBadgeVariant(goal.status)}>
                    {goal.status}
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span>{progress.toFixed(1)}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>₹{goal.currentAmount.toLocaleString()}</span>
                    <span>₹{goal.targetAmount.toLocaleString()}</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div>
                    <div className="text-sm text-muted-foreground">Monthly SIP</div>
                    <div className="font-semibold">₹{goal.monthlyContribution.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Time Remaining</div>
                    <div className="font-semibold">
                      {yearsRemaining > 0 && `${yearsRemaining}y `}
                      {remainingMonths > 0 && `${remainingMonths}m`}
                      {monthsRemaining === 0 && 'Due now'}
                    </div>
                  </div>
                </div>
                
                <div className="pt-2 border-t">
                  <div className="text-sm text-muted-foreground">Target Date</div>
                  <div className="font-semibold">{new Date(goal.targetDate).toLocaleDateString('en-IN', { 
                    day: 'numeric', 
                    month: 'long', 
                    year: 'numeric' 
                  })}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {goals.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center py-8">
            <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Financial Goals Set</h3>
            <p className="text-muted-foreground mb-4">Start by creating your first financial goal to track your progress.</p>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Goal
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}