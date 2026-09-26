/**
 * Sync Orchestrator Service
 * 
 * Orchestrates the entire data synchronization process using functional approach
 */

import { getAllSchemes } from '@/services/groww';
import { fetchEnhancedData } from '@/services/dataFetcher';
import { processSchemes } from '@/services/batchProcessor';
import { collectHoldings } from '@/services/dataProcessor';
import { exportToCSV, exportToJSON, updateLocalCache, writeHoldings } from '@/services/dataExporter';
import { saveFundsInBatches } from '@/services/firebaseService';
import { applyInceptionDates, fetchInceptionDates } from '@/services/inceptionDates';
import { createProgressCallback } from '@/utils/progressTracker';
import type { GrowwScheme } from '@/types/api';
import type { MutualFund } from '@/types/mutualFund';
import type { FundHoldings } from '@/types/holdings';
import type { RedirectedFund } from '@/services/groww';

export type SyncStep = 'fetching' | 'enhancing' | 'processing' | 'exporting' | 'saving' | 'complete' | 'error';

export interface SyncProgress {
  step: SyncStep;
  stepLabel: string;
  processed: number;
  total: number;
  errors: string[];
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

export interface SyncOptions {
  incremental?: boolean;
  limit?: number;
  exportCsv?: boolean;
  exportJson?: boolean;
  skipFirebase?: boolean;
  maxSchemesToFetch?: number;
  onProgress?: SyncProgressCallback;
  signal?: AbortSignal;
}

export interface SyncResult {
  totalProcessed: number;
  totalErrors: number;
  duration: number;
  exportedFiles: string[];
  summary: {
    schemes: number;
    processed: number;
    saved: number;
  };
}

/**
 * Execute the complete synchronization process
 */
export const executeSync = async (options: SyncOptions = {}): Promise<SyncResult> => {
  const startTime = Date.now();
  const errors: string[] = [];
  const reportProgress = options.onProgress || (() => {});

  console.log('🚀 Starting data synchronization...');

  try {
    // Step 1: Fetch schemes
    reportProgress({ step: 'fetching', stepLabel: 'Fetching schemes from Groww...', processed: 0, total: 0, errors });
    const schemes = await fetchSchemes(options, (msg) => {
      const match = msg.match(/page (\d+)\/(\d+)/);
      if (match) {
        const pageNum = parseInt(match[1], 10);
        const totalPages = parseInt(match[2], 10);
        reportProgress({ step: 'fetching', stepLabel: msg, processed: pageNum, total: totalPages, errors });
      } else {
        reportProgress({ step: 'fetching', stepLabel: msg, processed: 0, total: 0, errors });
      }
    });
    reportProgress({ step: 'fetching', stepLabel: 'Schemes fetched successfully', processed: schemes.length, total: schemes.length, errors });

    // Step 2: Enhance & Process data
    reportProgress({ step: 'enhancing', stepLabel: 'Fetching enhanced data (stats & search)...', processed: 0, total: schemes.length, errors });
    const { funds: processedFunds, holdings, redirects } = await processSchemesWithData(schemes, options, (step, processed, total, stepLabel) => {
      reportProgress({ step, stepLabel: stepLabel || 'Fetching enhanced data (stats & search)...', processed, total, errors });
    });

    // Step 3: Export data & Update Local Cache
    if (options.signal?.aborted) throw new Error('Sync cancelled by user');
    reportProgress({ step: 'exporting', stepLabel: 'Updating local cache...', processed: 0, total: processedFunds.length, errors });
    await updateLocalCache(processedFunds);
    await writeHoldings(holdings);
    const exportedFiles = await exportData(processedFunds, options);
    
    // Step 4: Save to Firebase
    reportProgress({ step: 'saving', stepLabel: 'Saving to Firebase...', processed: 0, total: processedFunds.length, errors });
    const savedCount = await saveToFirebase(processedFunds, options, (saved, total) => {
      reportProgress({ step: 'saving', stepLabel: 'Saving to Firebase...', processed: saved, total, errors });
    });

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    const result: SyncResult = {
      totalProcessed: processedFunds.length,
      totalErrors: schemes.length - processedFunds.length,
      duration,
      exportedFiles,
      summary: {
        schemes: schemes.length,
        processed: processedFunds.length,
        saved: savedCount,
      },
    };

    reportProgress({ step: 'complete', stepLabel: 'Synchronization complete!', processed: processedFunds.length, total: processedFunds.length, errors });
    logSummary(result);
    logRedirectReport(redirects, processedFunds);
    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    errors.push(errorMsg);
    reportProgress({ step: 'error', stepLabel: `Synchronization failed: ${errorMsg}`, processed: 0, total: 0, errors });
    console.error('\n❌ Synchronization failed:', error);
    throw error;
  }
};

/**
 * Fetch schemes from Groww API
 */
const fetchSchemes = async (options: SyncOptions, onProgress?: (msg: string) => void): Promise<GrowwScheme[]> => {
  console.log('\n📡 Fetching schemes from Groww API...');
  
  if (options.signal?.aborted) throw new Error('Sync cancelled by user');
  const rawSchemes = await getAllSchemes(options.maxSchemesToFetch, onProgress, options.signal);
  
  // Deduplicate by scheme.id (Groww API sometimes returns duplicates across pages)
  const uniqueMap = new Map<string, GrowwScheme>();
  for (const s of rawSchemes) {
    if (s.id) uniqueMap.set(s.id, s);
  }
  
  // Immediately filter out schemes with invalid or missing scheme_codes
  // A fund without a valid scheme code is unusable for our app.
  let schemes = Array.from(uniqueMap.values()).filter(s => {
    const code = parseInt(String(s.scheme_code), 10);
    return !isNaN(code);
  });

  console.log(`📊 Fetched ${rawSchemes.length} raw schemes, kept ${schemes.length} valid unique schemes.`);

  if (options.limit) {
    schemes = schemes.slice(0, options.limit);
    console.log(`🔢 Limited to first ${options.limit} schemes`);
  }

  return schemes;
};

/**
 * Process schemes with enhanced data
 */
const processSchemesWithData = async (
  schemes: GrowwScheme[],
  options: SyncOptions,
  onStepProgress?: (step: SyncStep, processed: number, total: number, stepLabel?: string) => void,
): Promise<{ funds: MutualFund[]; holdings: Record<string, FundHoldings>; redirects: RedirectedFund[] }> => {
  console.log('\n🔄 Processing schemes with enhanced data...');
  
  if (options.signal?.aborted) throw new Error('Sync cancelled by user');

  // Fetch all enhanced data upfront
  let currentEnhancedProgress = 0;

  const enhancedData = await fetchEnhancedData(
    schemes, 
    {
      statsBatchSize: 10,
      searchBatchSize: 10,
      statsDelay: 500,
      searchDelay: 500,
    },
    options.signal,
    (msg) => {
      const match = msg.match(/batch (\d+)\/(\d+)/);
      if (match) {
        const batchNum = parseInt(match[1], 10);
        // Each batch is 10 items. We use Math.max so it never goes backwards if the parallel requests resolve out of order.
        currentEnhancedProgress = Math.max(currentEnhancedProgress, batchNum * 10);
        const displayProcessed = Math.min(currentEnhancedProgress, schemes.length);
        onStepProgress?.('enhancing', displayProcessed, schemes.length, msg);
      } else {
        onStepProgress?.('enhancing', currentEnhancedProgress, schemes.length, msg);
      }
    }
  );
  
  // Process schemes in batches
  if (options.signal?.aborted) throw new Error('Sync cancelled by user');
  onStepProgress?.('processing', 0, schemes.length, 'Processing and transforming funds...');

  const progressCallback = createProgressCallback('Processing', 50);
  const processedFunds = await processSchemes(
    schemes,
    enhancedData,
    {
      batchSize: 100,
      batchDelay: 100,
      onProgress: (processed, total) => {
        progressCallback(processed, total);
        onStepProgress?.('processing', processed, total, 'Transforming Groww data into MutualFund models...');
      },
      signal: options.signal
    }
  );

  // Holdings come from search responses already in hand, so this costs no extra
  // requests — it is pure extraction.
  const holdings = collectHoldings(schemes, enhancedData.searchData);
  console.log(`📦 Collected holdings for ${Object.keys(holdings).length}/${schemes.length} funds`);

  // Enrichment, not a dependency: if this fails the track record falls back to
  // return-horizon inference, so a failure must not abort an otherwise good sync.
  if (options.signal?.aborted) throw new Error('Sync cancelled by user');
  onStepProgress?.('processing', processedFunds.length, processedFunds.length, 'Fetching AMFI inception dates...');

  try {
    const dates = await fetchInceptionDates(options.signal);
    return { funds: applyInceptionDates(processedFunds, dates).funds, holdings, redirects: enhancedData.redirects };
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Sync cancelled by user');
    console.warn('⚠️ Inception date enrichment failed; continuing without it:', error);
    return { funds: processedFunds, holdings, redirects: enhancedData.redirects };
  }
};

/**
 * Export data to files if requested
 */
const exportData = async (funds: MutualFund[], options: SyncOptions): Promise<string[]> => {
  const exportedFiles: string[] = [];

  if (options.exportCsv) {
    console.log('\n💾 Exporting to CSV...');
    const csvFile = await exportToCSV(funds);
    exportedFiles.push(csvFile);
  }

  if (options.exportJson) {
    console.log('\n💾 Exporting to JSON...');
    const jsonFile = await exportToJSON(funds);
    exportedFiles.push(jsonFile);
  }

  return exportedFiles;
};

/**
 * Save data to Firebase
 */
const saveToFirebase = async (
  funds: MutualFund[],
  options: SyncOptions,
  onSaveProgress?: (saved: number, total: number) => void,
): Promise<number> => {
  if (options.skipFirebase) {
    // Phrased as a normal outcome, not a failure: this is the default path now,
    // and the published static files are what the app actually reads.
    console.log(
      '\n⏭️  Firestore not written (default). The app serves the static files just written.' +
        '\n    Pass --firebase, or run `pnpm sync:data:firebase`, to refresh the Firestore fallback.',
    );
    return 0;
  }

  console.log('\n🔥 Saving to Firebase...');
  if (options.signal?.aborted) throw new Error('Sync cancelled by user');
  const progressCallback = createProgressCallback('Firebase', 100);
  
  const isFullSync = !options.incremental && !options.limit && !options.maxSchemesToFetch;

  await saveFundsInBatches(
    funds, 
    500, 
    (saved, total) => {
      progressCallback(saved, total);
      onSaveProgress?.(saved, total);
    }, 
    options.signal,
    isFullSync
  );
  return funds.length;
};

/**
 * Log synchronization summary
 */
const logSummary = (result: SyncResult): void => {
  console.log('\n🎉 Synchronization completed successfully!');
  console.log('📊 Summary:');
  console.log(`   • Schemes fetched: ${result.summary.schemes}`);
  console.log(`   • Funds processed: ${result.summary.processed}`);
  console.log(`   • Funds saved: ${result.summary.saved}`);
  console.log(`   • Errors: ${result.totalErrors}`);
  console.log(`   • Duration: ${result.duration} seconds`);
  
  if (result.exportedFiles.length > 0) {
    console.log(`   • Exported files: ${result.exportedFiles.join(', ')}`);
  }
};

/**
 * Log a report of redirected/replaced funds and whether their
 * replacement target ended up in the final dataset.
 *
 * Handles chained redirects (A → B → C) by walking the redirect map
 * until the terminal destination is found.
 */
const logRedirectReport = (redirects: RedirectedFund[], funds: MutualFund[]): void => {
  if (redirects.length === 0) return;

  // Build a set of search_ids that made it into the dataset.
  const datasetSearchIds = new Set<string>();
  for (const f of funds) {
    if (f.id) datasetSearchIds.add(f.id);
  }

  // Build a redirect map: oldId → redirect entry, so we can resolve chains.
  const redirectMap = new Map<string, RedirectedFund>();
  for (const r of redirects) {
    redirectMap.set(r.oldId, r);
  }

  /**
   * Walk the redirect chain from a starting redirect to its terminal
   * destination. Returns the chain of hops and the final search_id/name.
   * Guards against cycles with a visited set.
   */
  const resolveChain = (start: RedirectedFund): {
    finalSearchId: string;
    finalSchemeName: string | null;
    chain: string[]; // intermediate scheme names for display
  } => {
    const visited = new Set<string>();
    visited.add(start.oldId);

    let current = start;
    const chain: string[] = [];

    while (redirectMap.has(current.newSearchId) && !visited.has(current.newSearchId)) {
      // The target is itself redirected — follow the chain.
      chain.push(current.newSchemeName ?? current.newSearchId);
      visited.add(current.newSearchId);
      current = redirectMap.get(current.newSearchId)!;
    }

    return {
      finalSearchId: current.newSearchId,
      finalSchemeName: current.newSchemeName,
      chain,
    };
  };

  // Only report "root" redirects — those whose oldId is not the target of
  // another redirect. Intermediate hops are shown inline as part of the chain.
  const rootRedirects = redirects.filter((r) => {
    for (const other of redirects) {
      if (other.newSearchId === r.oldId) return false;
    }
    return true;
  });

  console.log(`\n🔀 Redirected / replaced funds: ${redirects.length} (${rootRedirects.length} unique chains)`);
  console.log('─'.repeat(100));

  let inDataset = 0;
  let missing = 0;

  for (const r of rootRedirects) {
    const { finalSearchId, finalSchemeName, chain } = resolveChain(r);
    const found = datasetSearchIds.has(finalSearchId);
    if (found) inDataset++;
    else missing++;

    const status = found ? '✅ in dataset' : '❌ NOT in dataset';
    const finalLabel = finalSchemeName ?? finalSearchId;

    if (chain.length > 0) {
      // Multi-hop: show the full path
      const hops = [r.oldSchemeName, ...chain, finalLabel].join(' → ');
      console.log(`  ${hops}  [${status}]`);
    } else {
      console.log(`  ${r.oldSchemeName}  → ${finalLabel}  [${status}]`);
    }
  }

  console.log('─'.repeat(100));
  console.log(`  ${inDataset} redirect target(s) present in dataset, ${missing} missing.`);
  if (missing > 0) {
    console.log('  Missing targets may be regular-plan or non-direct schemes that we intentionally exclude.');
  }
};
