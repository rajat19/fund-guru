/**
 * Data Synchronization Script
 *
 * This script fetches mutual fund data from Groww API and stores it in Firebase.
 * It can be run manually or as part of a scheduled job for daily updates.
 *
 * Usage:
 * - pnpm run sync:data - Full sync of all mutual funds
 * - pnpm run sync:data -- --incremental - Only sync funds that need updates
 * - pnpm run sync:data -- --limit 100 - Limit sync to first 100 funds
 */

import { executeSync } from '@/services/syncOrchestrator';

interface SyncOptions {
  incremental?: boolean;
  limit?: number;
  exportCsv?: boolean;
  exportJson?: boolean;
  skipFirebase?: boolean;
  verify?: boolean;
  verifyId?: string;
  maxSchemesToFetch?: number;
}

const synchronizeData = async (options: SyncOptions = {}): Promise<void> => {
  console.log('🚀 Starting mutual fund data synchronization...');
  console.log('Options:', options);

  try {
    // Execute main synchronization
    await executeSync({
      incremental: options.incremental,
      limit: options.limit,
      exportCsv: options.exportCsv,
      exportJson: options.exportJson,
      skipFirebase: options.skipFirebase,
      maxSchemesToFetch: options.maxSchemesToFetch,
    });

  } catch (error) {
    console.error('\n❌ Synchronization failed:', error);
    throw error;
  }
};

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  const options: SyncOptions = {
    incremental: args.includes('--incremental'),
    exportCsv: args.includes('--csv'),
    exportJson: args.includes('--json'),
    skipFirebase: args.includes('--skip-firebase'),
  };

  // Parse limit argument
  const limitIndex = args.indexOf('--limit');
  if (limitIndex !== -1 && args[limitIndex + 1]) {
    options.limit = parseInt(args[limitIndex + 1], 10);
  }

  // Parse maxSchemesToFetch argument
  const maxSchemesIndex = args.indexOf('--max-schemes');
  if (maxSchemesIndex !== -1 && args[maxSchemesIndex + 1]) {
    options.maxSchemesToFetch = parseInt(args[maxSchemesIndex + 1], 10);
  }

  await synchronizeData(options);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

export { synchronizeData };