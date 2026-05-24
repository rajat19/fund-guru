import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { getMetadata, type FirebaseMetadata } from '@/services/firebaseService';
import { executeSync, type SyncProgress, type SyncResult } from '@/services/syncOrchestrator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  RefreshCw,
  Shield,
  ShieldAlert,
  LogIn,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Database,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';

export default function Admin() {
  const { user, isAdmin, isLoading: authLoading, signInWithGoogle } = useAuth();

  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Sync options
  const [schemeLimit, setSchemeLimit] = useState<string>('20');
  const [skipFirebase, setSkipFirebase] = useState(false);

  // Fetch last sync metadata
  const { data: metadata, refetch: refetchMetadata } = useQuery<FirebaseMetadata | null>({
    queryKey: ['sync-metadata'],
    queryFn: getMetadata,
    staleTime: 30 * 1000,
    enabled: isAdmin,
  });

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    setSyncProgress(null);

    try {
      const result = await executeSync({
        maxSchemesToFetch: schemeLimit ? parseInt(schemeLimit, 10) : undefined,
        skipFirebase,
        onProgress: (progress) => {
          setSyncProgress({ ...progress });
        },
      });

      setSyncResult(result);
      refetchMetadata();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setSyncError(errorMsg);
    } finally {
      setIsSyncing(false);
    }
  }, [schemeLimit, skipFirebase, refetchMetadata]);

  const getProgressPercent = (): number => {
    if (!syncProgress || syncProgress.total === 0) return 0;
    return Math.round((syncProgress.processed / syncProgress.total) * 100);
  };

  // Loading state
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not signed in
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <LogIn className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Admin Access</CardTitle>
            <CardDescription>
              Sign in with your Google account to access the admin panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={signInWithGoogle} size="lg" className="gap-2">
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Signed in but not admin
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Access Denied</CardTitle>
            <CardDescription>
              You are signed in as <strong>{user.email}</strong>, but your account does not have admin
              privileges. Contact the project owner to request admin access.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Admin view
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {user.displayName || user.email}
          </p>
        </div>
      </div>

      <Separator />

      {/* Last Sync Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Database className="h-5 w-5" />
            Last Sync Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metadata ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Last Updated</p>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium text-sm">
                    {format(metadata.lastUpdated, 'PPpp')}
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total Funds</p>
                <p className="font-medium text-lg">{metadata.totalFunds.toLocaleString()}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge
                  variant={
                    metadata.lastSyncStatus === 'success'
                      ? 'default'
                      : metadata.lastSyncStatus === 'partial'
                        ? 'secondary'
                        : 'destructive'
                  }
                  className="gap-1"
                >
                  {metadata.lastSyncStatus === 'success' && <CheckCircle2 className="h-3 w-3" />}
                  {metadata.lastSyncStatus === 'partial' && <AlertTriangle className="h-3 w-3" />}
                  {metadata.lastSyncStatus === 'failed' && <XCircle className="h-3 w-3" />}
                  {metadata.lastSyncStatus}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No sync metadata found. Run your first sync below.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Sync Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <RefreshCw className="h-5 w-5" />
            Sync Mutual Funds
          </CardTitle>
          <CardDescription>
            Fetch mutual fund data from Groww API and save to Firestore. This works in development
            mode (localhost) where the Vite proxy handles CORS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scheme-limit">Max Schemes to Fetch</Label>
              <Input
                id="scheme-limit"
                type="number"
                placeholder="Leave empty for all"
                value={schemeLimit}
                onChange={(e) => setSchemeLimit(e.target.value)}
                disabled={isSyncing}
                min={1}
              />
              <p className="text-xs text-muted-foreground">
                Limit the number of schemes. Use a small number (e.g. 20) for testing.
              </p>
            </div>
            <div className="flex items-center space-x-3 pt-6">
              <Switch
                id="skip-firebase"
                checked={skipFirebase}
                onCheckedChange={setSkipFirebase}
                disabled={isSyncing}
              />
              <Label htmlFor="skip-firebase" className="cursor-pointer">
                Skip Firebase save (dry run)
              </Label>
            </div>
          </div>

          {/* Sync Button */}
          <Button onClick={handleSync} disabled={isSyncing} size="lg" className="gap-2 w-full sm:w-auto">
            {isSyncing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Sync Mutual Funds
              </>
            )}
          </Button>

          {/* Progress */}
          {syncProgress && isSyncing && (
            <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{syncProgress.stepLabel}</p>
                <Badge variant="outline" className="text-xs">
                  {syncProgress.step}
                </Badge>
              </div>
              <Progress value={getProgressPercent()} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {syncProgress.processed} / {syncProgress.total} items
                {syncProgress.errors.length > 0 && (
                  <span className="text-destructive ml-2">
                    ({syncProgress.errors.length} errors)
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Result */}
          {syncResult && !isSyncing && (
            <div className="rounded-lg border p-4 bg-green-500/5 border-green-500/20">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <p className="font-medium text-green-700 dark:text-green-400">
                  Sync Completed Successfully
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Schemes</p>
                  <p className="font-medium">{syncResult.summary.schemes}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Processed</p>
                  <p className="font-medium">{syncResult.summary.processed}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Saved</p>
                  <p className="font-medium">{syncResult.summary.saved}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Duration</p>
                  <p className="font-medium">{syncResult.duration}s</p>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {syncError && !isSyncing && (
            <div className="rounded-lg border p-4 bg-destructive/5 border-destructive/20">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="h-5 w-5 text-destructive" />
                <p className="font-medium text-destructive">Sync Failed</p>
              </div>
              <p className="text-sm text-muted-foreground">{syncError}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
