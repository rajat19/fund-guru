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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { User, Shield, Target, DollarSign, Edit2, Save } from 'lucide-react';

export default function Profile() {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [profile, setProfile] = useState({
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+91 98765 43210',
    age: 32,
    occupation: 'Software Engineer',
    annualIncome: '₹15,00,000',
    riskTolerance: 'Moderate',
    investmentExperience: '3-5 years',
    investmentGoals: 'Retirement planning, wealth creation',
    timeHorizon: '10+ years',
    monthlyInvestmentCapacity: '₹25,000',
  });

  const handleSave = () => {
    setIsEditing(false);
    toast({
      title: 'Profile Updated',
      description: 'Your profile has been successfully updated.',
    });
  };

  const handleInputChange = (field: string, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Profile</h1>
          <p className="text-muted-foreground">Manage your personal and investment information</p>
        </div>
        <Button
          onClick={isEditing ? handleSave : () => setIsEditing(true)}
          variant={isEditing ? 'default' : 'outline'}
        >
          {isEditing ? <Save className="h-4 w-4 mr-2" /> : <Edit2 className="h-4 w-4 mr-2" />}
          {isEditing ? 'Save Changes' : 'Edit Profile'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Personal Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Full Name</Label>
                {isEditing ? (
                  <Input
                    id="name"
                    value={profile.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                  />
                ) : (
                  <div className="font-semibold">{profile.name}</div>
                )}
              </div>
              <div>
                <Label htmlFor="age">Age</Label>
                {isEditing ? (
                  <Input
                    id="age"
                    type="number"
                    value={profile.age}
                    onChange={(e) => handleInputChange('age', e.target.value)}
                  />
                ) : (
                  <div className="font-semibold">{profile.age} years</div>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              {isEditing ? (
                <Input
                  id="email"
                  type="email"
                  value={profile.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                />
              ) : (
                <div className="font-semibold">{profile.email}</div>
              )}
            </div>

            <div>
              <Label htmlFor="phone">Phone</Label>
              {isEditing ? (
                <Input
                  id="phone"
                  value={profile.phone}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                />
              ) : (
                <div className="font-semibold">{profile.phone}</div>
              )}
            </div>

            <div>
              <Label htmlFor="occupation">Occupation</Label>
              {isEditing ? (
                <Input
                  id="occupation"
                  value={profile.occupation}
                  onChange={(e) => handleInputChange('occupation', e.target.value)}
                />
              ) : (
                <div className="font-semibold">{profile.occupation}</div>
              )}
            </div>

            <div>
              <Label htmlFor="income">Annual Income</Label>
              {isEditing ? (
                <Input
                  id="income"
                  value={profile.annualIncome}
                  onChange={(e) => handleInputChange('annualIncome', e.target.value)}
                />
              ) : (
                <div className="font-semibold">{profile.annualIncome}</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Investment Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Investment Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="risk">Risk Tolerance</Label>
              {isEditing ? (
                <Select
                  value={profile.riskTolerance}
                  onValueChange={(value) => handleInputChange('riskTolerance', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Moderate">Moderate</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge
                  variant={
                    profile.riskTolerance === 'Low'
                      ? 'default'
                      : profile.riskTolerance === 'Moderate'
                        ? 'secondary'
                        : 'destructive'
                  }
                >
                  {profile.riskTolerance}
                </Badge>
              )}
            </div>

            <div>
              <Label htmlFor="experience">Investment Experience</Label>
              {isEditing ? (
                <Select
                  value={profile.investmentExperience}
                  onValueChange={(value) => handleInputChange('investmentExperience', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Less than 1 year">Less than 1 year</SelectItem>
                    <SelectItem value="1-3 years">1-3 years</SelectItem>
                    <SelectItem value="3-5 years">3-5 years</SelectItem>
                    <SelectItem value="5+ years">5+ years</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="font-semibold">{profile.investmentExperience}</div>
              )}
            </div>

            <div>
              <Label htmlFor="horizon">Time Horizon</Label>
              {isEditing ? (
                <Select
                  value={profile.timeHorizon}
                  onValueChange={(value) => handleInputChange('timeHorizon', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Less than 1 year">Less than 1 year</SelectItem>
                    <SelectItem value="1-3 years">1-3 years</SelectItem>
                    <SelectItem value="3-5 years">3-5 years</SelectItem>
                    <SelectItem value="5-10 years">5-10 years</SelectItem>
                    <SelectItem value="10+ years">10+ years</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="font-semibold">{profile.timeHorizon}</div>
              )}
            </div>

            <div>
              <Label htmlFor="capacity">Monthly Investment Capacity</Label>
              {isEditing ? (
                <Input
                  id="capacity"
                  value={profile.monthlyInvestmentCapacity}
                  onChange={(e) => handleInputChange('monthlyInvestmentCapacity', e.target.value)}
                />
              ) : (
                <div className="font-semibold">{profile.monthlyInvestmentCapacity}</div>
              )}
            </div>

            <div>
              <Label htmlFor="goals">Investment Goals</Label>
              {isEditing ? (
                <Textarea
                  id="goals"
                  value={profile.investmentGoals}
                  onChange={(e) => handleInputChange('investmentGoals', e.target.value)}
                  rows={3}
                />
              ) : (
                <div className="font-semibold">{profile.investmentGoals}</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Investment Summary */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Investment Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">₹2,45,000</div>
              <div className="text-sm text-muted-foreground">Total Invested</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-profit">₹2,89,500</div>
              <div className="text-sm text-muted-foreground">Current Value</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-profit">+₹44,500</div>
              <div className="text-sm text-muted-foreground">Total Gains</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-profit">+18.16%</div>
              <div className="text-sm text-muted-foreground">Overall Return</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
