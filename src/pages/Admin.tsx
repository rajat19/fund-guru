import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMetadata, type FirebaseMetadata, saveFundsInBatches } from '@/services/firebaseService';
import { executeSync, type SyncProgress, type SyncResult } from '@/services/syncOrchestrator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { FUNDS_CACHE_KEY, setLocalCache } from '@/utils/cache';
import { ScoringConfigSection } from '@/components/ScoringConfigSection';
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
  UploadCloud,
} from 'lucide-react';
import { format } from 'date-fns';

export default function Admin() {
  const { user, isAdmin, isLoading: authLoading, signInWithGoogle } = useAuth();
  const queryClient = useQueryClient();

  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncType, setSyncType] = useState<'quick' | 'full' | 'upload' | null>(null);
  const isSyncing = syncType !== null;
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStartTime, setSyncStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Live timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isSyncing && syncStartTime) {
      interval = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - syncStartTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isSyncing, syncStartTime]);
  
  // Abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync options
  const [skipFirebase, setSkipFirebase] = useState(false);

  // Fetch last sync metadata
  const { data: metadata, refetch: refetchMetadata } = useQuery<FirebaseMetadata | null>({
    queryKey: ['sync-metadata'],
    queryFn: getMetadata,
    staleTime: 30 * 1000,
    enabled: isAdmin,
  });

  const executeSyncAction = useCallback(async (isFullSync: boolean) => {
    setSyncType(isFullSync ? 'full' : 'quick');
    setSyncStartTime(Date.now());
    setElapsedSeconds(0);
    setSyncResult(null);
    setSyncError(null);
    setSyncProgress(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await executeSync({
        maxSchemesToFetch: isFullSync ? undefined : 20,
        skipFirebase,
        signal: abortControllerRef.current.signal,
        onProgress: (progress) => {
          setSyncProgress({ ...progress });
        },
      });

      setSyncResult(result);
      refetchMetadata();
      
      // Force UI to refetch from IndexedDB which was just updated
      queryClient.invalidateQueries({ queryKey: ['mutual-funds'] });
      queryClient.invalidateQueries({ queryKey: ['mutual-funds-by-category'] });
      queryClient.invalidateQueries({ queryKey: ['top-performing-funds'] });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === 'Sync cancelled by user') {
        setSyncError('Synchronization was cancelled by the user.');
      } else {
        setSyncError(errorMsg);
      }
    } finally {
      setSyncType(null);
      setSyncStartTime(null);
      abortControllerRef.current = null;
    }
  }, [skipFirebase, refetchMetadata]);

  const handleQuickSync = () => executeSyncAction(false);
  const handleFullSync = () => executeSyncAction(true);

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleUploadCache = useCallback(async () => {
    setSyncType('upload');
    setSyncStartTime(Date.now());
    setElapsedSeconds(0);
    setSyncResult(null);
    setSyncError(null);
    setSyncProgress(null);

    abortControllerRef.current = new AbortController();

    try {
      setSyncProgress({
        step: 'fetching',
        stepLabel: 'Downloading local cache file...',
        processed: 0,
        total: 0,
        errors: [],
      });

      const response = await fetch('/data/funds-cache.json');
      if (!response.ok) {
        throw new Error(`Failed to load cache file: ${response.statusText}`);
      }

      const funds = await response.json();
      
      setSyncProgress({
        step: 'saving',
        stepLabel: 'Uploading cache to Firebase...',
        processed: 0,
        total: funds.length,
        errors: [],
      });

      const startTime = Date.now();
      await saveFundsInBatches(
        funds,
        500,
        (saved, total) => {
          setSyncProgress({
            step: 'saving',
            stepLabel: 'Uploading cache to Firebase...',
            processed: saved,
            total,
            errors: [],
          });
        },
        abortControllerRef.current.signal,
        true // isFullSync
      );

      const duration = Math.round((Date.now() - startTime) / 1000);

      setSyncProgress({
        step: 'complete',
        stepLabel: 'Upload complete!',
        processed: funds.length,
        total: funds.length,
        errors: [],
      });

      setSyncResult({
        totalProcessed: funds.length,
        totalErrors: 0,
        duration,
        exportedFiles: [],
        summary: {
          schemes: funds.length,
          processed: funds.length,
          saved: funds.length,
        },
      });

      // Update the IndexedDB cache with the newly uploaded data so UI updates instantly
      await setLocalCache(FUNDS_CACHE_KEY, funds);

      refetchMetadata();
      
      // Force UI to refetch from IndexedDB
      queryClient.invalidateQueries({ queryKey: ['mutual-funds'] });
      queryClient.invalidateQueries({ queryKey: ['mutual-funds-by-category'] });
      queryClient.invalidateQueries({ queryKey: ['top-performing-funds'] });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === 'Sync cancelled by user') {
        setSyncError('Upload was cancelled by the user.');
      } else {
        setSyncError(errorMsg);
      }
    } finally {
      setSyncType(null);
      setSyncStartTime(null);
      abortControllerRef.current = null;
    }
  }, [refetchMetadata]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

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
          <div className="grid grid-cols-1 gap-4">
            <div className="flex items-center space-x-3">
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

          {/* Sync Buttons */}
          <div className="space-y-4">
            {/* Safe Row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={handleQuickSync} disabled={isSyncing} size="lg" className="gap-2 w-full sm:w-auto">
                {syncType === 'quick' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Quick Sync (20 Funds)
                  </>
                )}
              </Button>
              <Button 
                onClick={handleUploadCache} 
                disabled={isSyncing} 
                variant="outline" 
                size="lg" 
                className="gap-2 w-full sm:w-auto"
              >
                {syncType === 'upload' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-4 w-4" />
                    Upload Local Cache
                  </>
                )}
              </Button>
              {isSyncing && (
                <Button onClick={handleCancel} variant="destructive" size="lg" className="gap-2 w-full sm:w-auto">
                  <XCircle className="h-4 w-4" />
                  Cancel Sync
                </Button>
              )}
            </div>

            <Separator />

            {/* Destructive Row */}
            <div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={isSyncing} variant="destructive" size="lg" className="gap-2 w-full sm:w-auto">
                    {syncType === 'full' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4" />
                        Full Sync Database
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action will fetch over 1,700 funds from the Groww API and overwrite your entire Firebase database. 
                      It will also permanently delete any stale or orphaned funds that are no longer available.
                      This process can take several minutes.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleFullSync} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Continue with Full Sync
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* Progress */}
          {syncProgress && isSyncing && (
            <div className="space-y-4 rounded-lg border p-5 bg-muted/20">
              <div className="flex flex-col space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">Sync Progress</h3>
                  <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s
                  </span>
                </div>
                
                <div className="space-y-4 pt-2">
                  {[
                    { id: 'fetching', label: '1. Fetching base schemes' },
                    { id: 'enhancing', label: '2. Fetching enhanced stats & search data' },
                    { id: 'processing', label: '3. Processing and transforming funds' },
                    { id: 'exporting', label: '4. Updating local cache' },
                    { id: 'saving', label: '5. Saving to Firebase' }
                  ].map((stepConfig) => {
                    const stepOrder = syncType === 'upload' 
                      ? ['fetching', 'saving'] 
                      : ['fetching', 'enhancing', 'processing', 'exporting', 'saving'];
                      
                    const currentStepIndex = syncProgress.step === 'complete' || syncProgress.step === 'error'
                      ? stepOrder.length
                      : stepOrder.indexOf(syncProgress.step);
                      
                    const thisStepIndex = stepOrder.indexOf(stepConfig.id);
                    
                    if (thisStepIndex === -1) return null;

                    const isCompleted = thisStepIndex < currentStepIndex;
                    const isActive = thisStepIndex === currentStepIndex;
                    const isPending = thisStepIndex > currentStepIndex;

                    return (
                      <div key={stepConfig.id} className={`flex flex-col space-y-2 ${isPending ? 'opacity-40' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isCompleted && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                            {isActive && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                            {isPending && <div className="h-4 w-4 rounded-full border-2" />}
                            <span className={`text-sm ${isActive ? 'font-medium text-primary' : 'text-muted-foreground'}`}>
                              {stepConfig.label}
                            </span>
                          </div>
                          {isActive && syncProgress.total > 0 && (
                            <span className="text-xs font-mono">
                              {syncProgress.processed} / {syncProgress.total}
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <div className="pl-6 space-y-2">
                            <p className="text-xs text-muted-foreground italic truncate">
                              {syncProgress.stepLabel}
                              {syncProgress.errors.length > 0 && (
                                <span className="text-destructive ml-2 font-normal not-italic">
                                  ({syncProgress.errors.length} errors)
                                </span>
                              )}
                            </p>
                            <Progress value={getProgressPercent()} className="h-1.5" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
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

      {/* AI Scoring Configuration */}
      <ScoringConfigSection />
    </div>
  );
}
