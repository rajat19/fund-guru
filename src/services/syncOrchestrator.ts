/**
 * Sync Orchestrator Service
 * 
 * Orchestrates the entire data synchronization process using functional approach
 */

import { getAllSchemes } from '@/services/groww';
import { fetchEnhancedData } from '@/services/dataFetcher';
import { processSchemes } from '@/services/batchProcessor';
import { exportToCSV, exportToJSON, updateLocalCache } from '@/services/dataExporter';
import { saveFundsInBatches } from '@/services/firebaseService';
import { createProgressCallback } from '@/utils/progressTracker';
import type { GrowwScheme } from '@/types/api';
import type { MutualFund } from '@/types/mutualFund';

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
    const processedFunds = await processSchemesWithData(schemes, options, (step, processed, total, stepLabel) => {
      reportProgress({ step, stepLabel: stepLabel || 'Fetching enhanced data (stats & search)...', processed, total, errors });
    });

    // Step 3: Export data & Update Local Cache
    if (options.signal?.aborted) throw new Error('Sync cancelled by user');
    reportProgress({ step: 'exporting', stepLabel: 'Updating local cache...', processed: 0, total: processedFunds.length, errors });
    await updateLocalCache(processedFunds);
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
  let rawSchemes = await getAllSchemes(options.maxSchemesToFetch, onProgress, options.signal);
  
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
): Promise<MutualFund[]> => {
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

  return processedFunds;
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
    console.log('\n⏭️  Skipping Firebase save');
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
