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
import { DATASET_PATH, isFundDataset } from '@/types/dataset';

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
  
  /*
   * Firestore is opt-in.
   *
   * The app reads the published static files, and CI fails the build if
   * funds.json is missing or malformed, so a deploy cannot ship without one.
   * Firestore is only reachable as a runtime fallback for a signed-in visitor
   * when that file 404s — and it has no holdings mirror anyway, so the fallback
   * is partial by construction.
   *
   * Writing it by default cost ~1,541 reads plus ~1,541 writes on every sync and
   * was the only reason the sync needed Firebase credentials at all. Pass
   * --firebase (or `pnpm sync:data:firebase`) to refresh it deliberately.
   *
   * --skip-firebase is still accepted so existing invocations keep working.
   */
  const options: SyncOptions = {
    incremental: args.includes('--incremental'),
    exportCsv: args.includes('--csv'),
    exportJson: args.includes('--json'),
    skipFirebase: !args.includes('--firebase'),
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
  console.log('  1. Full sync — fetch from Groww, write funds.json + holdings.json  (~15-20 mins)');
  console.log('     Commit those two files and push; that is what the app serves.');
  console.log('  2. Push the existing public/data/funds.json to Firestore           (~10s)');
  console.log('     Only refreshes the fallback. Not needed for a normal deploy.');
  console.log('  3. Full sync AND push to Firestore                                 (~15-20 mins)');

  const answer = (await askQuestion('\nSelect an option [1/2/3]: ')).trim();

  if (answer === '3') {
    console.log('\n🔄 Starting full sync from Groww, including the Firestore write...');
    await synchronizeData({ ...options, skipFirebase: false });
    return;
  }

  if (answer === '2') {
    const datasetPath = path.resolve(process.cwd(), 'public', DATASET_PATH);
    try {
      console.log(`\n📖 Reading ${datasetPath}...`);
      const raw = JSON.parse(await fs.readFile(datasetPath, 'utf-8')) as unknown;

      if (!isFundDataset(raw)) {
        throw new Error('File is not a dataset envelope — re-run a full sync to regenerate it');
      }

      console.log(
        `📤 Found ${raw.funds.length} funds generated ${raw.generatedAt}. Uploading to Firebase...`,
      );
      await saveFundsInBatches(raw.funds, 500, undefined, undefined, true);
      console.log('\n🎉 Upload complete!');
    } catch (error) {
      console.error(`\n❌ Failed to upload ${datasetPath}:`, error);
      process.exitCode = 1;
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