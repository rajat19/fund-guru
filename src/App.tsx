import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeProvider';
import { Layout } from '@/components/Layout';
import { Dashboard } from '@/components/Dashboard';
import { FundExplorer } from '@/components/FundExplorer';
import { SIPTracker } from '@/components/SIPTracker';
import FundDetail from './pages/FundDetail';
import Builder from './pages/Builder';
import Evaluate from './pages/Evaluate';
import Profile from './pages/Profile';
import SIPManagement from './pages/SIPManagement';
import Portfolio from './pages/Portfolio';
import Goals from './pages/Goals';
import Reports from './pages/Reports';
import Admin from './pages/Admin';
import NotFound from './pages/NotFound';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/explorer" element={<FundExplorer />} />
              <Route path="/builder" element={<Builder />} />
              {/* Public on purpose: signing in only adds the ability to save. */}
              <Route path="/evaluate" element={<Evaluate />} />
              <Route path="/fund/:id" element={<FundDetail />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/profile" element={<Profile />} />
                <Route path="/sip" element={<SIPTracker />} />
                <Route path="/portfolio" element={<Portfolio />} />
                <Route path="/goals" element={<Goals />} />
                <Route path="/reports" element={<Reports />} />
              </Route>
              <Route path="/admin" element={<Admin />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
