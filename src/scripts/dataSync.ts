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

import readline from 'readline';
import fs from 'fs/promises';
import path from 'path';
import { executeSync } from '@/services/syncOrchestrator';
import { saveFundsInBatches } from '@/services/firebaseService';

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
const askQuestion = (query: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
};

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

  // If arguments provided, run normally
  if (args.length > 0) {
    await synchronizeData(options);
    return;
  }

  // Interactive prompt
  console.log('\n=============================================');
  console.log('🤖 Welcome to the Fund-Guru Data Sync utility');
  console.log('=============================================\n');
  
  console.log('What would you like to do?');
  console.log('  1. Fetch fresh data from Groww and sync to Firebase (Full Sync, ~15-20 mins)');
  console.log('  2. Upload existing local cache directly to Firebase (Fast, ~10s)');
  
  const answer = await askQuestion('\nSelect an option [1/2]: ');

  if (answer.trim() === '2') {
    try {
      console.log('\n📖 Reading local cache...');
      const cachePath = path.resolve(process.cwd(), 'public/data/funds-cache.json');
      const cacheData = await fs.readFile(cachePath, 'utf-8');
      const funds = JSON.parse(cacheData);
      
      console.log(`📤 Found ${funds.length} funds. Uploading to Firebase...`);
      // Pass undefined for progress and signal, and true for isFullSync
      await saveFundsInBatches(funds, 500, undefined, undefined, true);
      console.log('\n🎉 Upload complete!');
    } catch (error) {
      console.error('\n❌ Failed to upload local cache. Does public/data/funds-cache.json exist?', error);
    }
  } else {
    // Default to option 1
    console.log('\n🔄 Starting full sync from Groww...');
    await synchronizeData(options);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

export { synchronizeData };