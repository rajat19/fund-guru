import { useState } from 'react';
import { Dashboard } from '@/components/Dashboard';
import { FundExplorer } from '@/components/FundExplorer';
import { SIPTracker } from '@/components/SIPTracker';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Search, PiggyBank, TrendingUp } from 'lucide-react';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">FundWise</h1>
                <p className="text-xs text-muted-foreground">Smart Mutual Fund Recommendations</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:grid-cols-3">
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="explorer" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Fund Explorer
            </TabsTrigger>
            <TabsTrigger value="sip" className="flex items-center gap-2">
              <PiggyBank className="h-4 w-4" />
              SIP Tracker
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <Dashboard />
          </TabsContent>

          <TabsContent value="explorer">
            <FundExplorer />
          </TabsContent>

          <TabsContent value="sip">
            <SIPTracker />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 mt-16">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>© 2024 FundWise. Smart investment decisions made simple.</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
