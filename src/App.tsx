import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import Index from './pages/Index';
import FundDetail from './pages/FundDetail';
import Profile from './pages/Profile';
import SIPManagement from './pages/SIPManagement';
import Portfolio from './pages/Portfolio';
import Goals from './pages/Goals';
import Reports from './pages/Reports';
import NotFound from './pages/NotFound';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/explorer" element={<Index />} />
            <Route path="/fund/:id" element={<FundDetail />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/sip" element={<SIPManagement />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/reports" element={<Reports />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
