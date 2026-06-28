/**
 * Batch Processor Service
 * 
 * Handles batch processing of schemes with progress tracking and error handling
 */

import { processSchemeData } from '@/services/dataProcessor';
import type { GrowwScheme } from '@/types/api';
import type { MutualFund } from '@/types/mutualFund';
import type { FetchedData } from '@/services/dataFetcher';

export interface BatchProcessorOptions {
  batchSize?: number;
  batchDelay?: number;
  onProgress?: (processed: number, total: number) => void;
  onError?: (error: Error, scheme: GrowwScheme) => void;
  signal?: AbortSignal;
}

/**
 * Process schemes in batches with enhanced data
 */
export const processSchemes = async (
  schemes: GrowwScheme[], 
  enhancedData: FetchedData, 
  options: BatchProcessorOptions = {}
): Promise<MutualFund[]> => {
  const batchOptions = {
    batchSize: options.batchSize ?? 100,
    batchDelay: options.batchDelay ?? 100,
    onProgress: options.onProgress,
    onError: options.onError,
    signal: options.signal,
  };

  console.log(`🔄 Processing ${schemes.length} schemes in batches of ${batchOptions.batchSize}...`);
  
  const processedFunds: MutualFund[] = [];
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < schemes.length; i += batchOptions.batchSize) {
    if (batchOptions.signal?.aborted) {
      console.log('⚠️ Scheme processing cancelled by user.');
      throw new Error('Sync cancelled by user');
    }

    const batch = schemes.slice(i, i + batchOptions.batchSize);
    
    console.log(
      `📦 Processing batch ${Math.floor(i / batchOptions.batchSize) + 1}/${Math.ceil(schemes.length / batchOptions.batchSize)} (${batch.length} schemes)`
    );

    for (const scheme of batch) {
      try {
        const search = enhancedData.searchData[scheme.id];
        
        // If search data is missing, the fund is likely replaced/invalid (dropped in searchSchemes.ts)
        if (!search) {
          console.warn(`⏭️ Skipping scheme ${scheme.id} (no valid search data, likely replaced)`);
          processed++;
          continue;
        }

        const processedFund = processScheme(scheme, enhancedData);
        processedFunds.push(processedFund);
        processed++;
      } catch (error) {
        errors++;
        const errorObj = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ Error processing scheme ${scheme.id}:`, errorObj.message);
        
        if (batchOptions.onError) {
          batchOptions.onError(errorObj, scheme);
        }
      }

      // Report progress
      if (batchOptions.onProgress) {
        batchOptions.onProgress(processed + errors, schemes.length);
      }
    }
    
    // Add delay between batches to be nice to system resources
    if (i + batchOptions.batchSize < schemes.length) {
      await delay(batchOptions.batchDelay);
    }
  }

  console.log(`✅ Batch processing completed: ${processed} successful, ${errors} errors`);
  return processedFunds;
};

/**
 * Process a single scheme with enhanced data
 */
const processScheme = (scheme: GrowwScheme, enhancedData: FetchedData): MutualFund => {
  const schemeCode = parseInt(scheme.scheme_code, 10);
  const stats = enhancedData.schemeStats[schemeCode];
  const search = enhancedData.searchData[scheme.id];
  
  return processSchemeData(scheme, stats, search);
};

/**
 * Simple delay utility
 */
const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};
