/**
 * Sync Orchestrator Service
 * 
 * Orchestrates the entire data synchronization process using functional approach
 */

import { getAllSchemes } from '@/services/groww';
import { fetchEnhancedData } from '@/services/dataFetcher';
import { processSchemes } from '@/services/batchProcessor';
import { exportToCSV, exportToJSON } from '@/services/dataExporter';
import { saveFundsInBatches } from '@/services/firebaseService';
import { createProgressCallback } from '@/utils/progressTracker';
import type { GrowwScheme } from '@/types/api';
import type { MutualFund } from '@/types/mutualFund';

export interface SyncOptions {
  incremental?: boolean;
  limit?: number;
  exportCsv?: boolean;
  exportJson?: boolean;
  skipFirebase?: boolean;
  maxSchemesToFetch?: number;
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
  console.log('🚀 Starting data synchronization...');

  try {
    // Step 1: Fetch schemes
    const schemes = await fetchSchemes(options);
    
    // Step 2: Process schemes with enhanced data
    const processedFunds = await processSchemesWithData(schemes);
    
    // Step 3: Export data if requested
    const exportedFiles = await exportData(processedFunds, options);
    
    // Step 4: Save to Firebase
    const savedCount = await saveToFirebase(processedFunds, options);

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

    logSummary(result);
    return result;

  } catch (error) {
    console.error('\n❌ Synchronization failed:', error);
    throw error;
  }
};

/**
 * Fetch schemes from Groww API
 */
const fetchSchemes = async (options: SyncOptions): Promise<GrowwScheme[]> => {
  console.log('\n📡 Fetching schemes from Groww API...');
  
  let schemes = await getAllSchemes(options.maxSchemesToFetch);
  console.log(`📊 Fetched ${schemes.length} schemes`);

  if (options.limit) {
    schemes = schemes.slice(0, options.limit);
    console.log(`🔢 Limited to first ${options.limit} schemes`);
  }

  return schemes;
};

/**
 * Process schemes with enhanced data
 */
const processSchemesWithData = async (schemes: GrowwScheme[]): Promise<MutualFund[]> => {
  console.log('\n🔄 Processing schemes with enhanced data...');
  
  // Fetch all enhanced data upfront
  const enhancedData = await fetchEnhancedData(schemes, {
    statsBatchSize: 10,
    searchBatchSize: 10,
    statsDelay: 500,
    searchDelay: 500,
  });
  
  // Process schemes in batches
  const progressCallback = createProgressCallback('Processing', 50);
  const processedFunds = await processSchemes(
    schemes, 
    enhancedData,
    {
      batchSize: 100,
      batchDelay: 100,
      onProgress: progressCallback
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
const saveToFirebase = async (funds: MutualFund[], options: SyncOptions): Promise<number> => {
  if (options.skipFirebase) {
    console.log('\n⏭️  Skipping Firebase save');
    return 0;
  }

  console.log('\n🔥 Saving to Firebase...');
  const progressCallback = createProgressCallback('Firebase', 100);
  
  await saveFundsInBatches(funds, 500, progressCallback);
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
