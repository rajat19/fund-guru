/**
 * Data Exporter Service
 * 
 * Handles exporting processed mutual fund data to various formats
 */

import { exportToCSV as generateCSV } from '@/services/dataProcessor';
import type { MutualFund } from '@/types/mutualFund';
import {
  DATASET_PATH,
  DATASET_SCHEMA_VERSION,
  type FundDataset,
} from '@/types/dataset';
import { FUNDS_CACHE_KEY, setLocalCache } from '@/utils/cache';

export interface ExportOptions {
  filename?: string;
  includeTimestamp?: boolean;
}

/**
 * Export mutual funds data to CSV file
 */
export const exportToCSV = async (funds: MutualFund[], options: ExportOptions = {}): Promise<string> => {
  const { 
    filename = 'mutual_funds_export',
    includeTimestamp = true 
  } = options;

  console.log('💾 Exporting data to CSV...');
  
  if (funds.length === 0) {
    throw new Error('No funds data to export');
  }

  const csvData = generateCSV(funds);
  const finalFilename = generateFilename(filename, 'csv', includeTimestamp);

  try {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined') {
      // Browser environment - create downloadable file
      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = finalFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      console.log(`✅ CSV download initiated: ${finalFilename}`);
      return finalFilename;
    } else {
      // Node.js environment - write to file system
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Ensure directory exists
      const dir = path.dirname(finalFilename);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(finalFilename, csvData);
      console.log(`✅ CSV exported to ${finalFilename}`);
      return finalFilename;
    }
  } catch (error) {
    console.error('❌ Failed to export CSV:', error);
    throw new Error(`Failed to export CSV: ${error}`);
  }
};

/**
 * Export mutual funds data to JSON file
 */
export const exportToJSON = async (funds: MutualFund[], options: ExportOptions = {}): Promise<string> => {
  const { 
    filename = 'mutual_funds_export',
    includeTimestamp = true 
  } = options;

  console.log('💾 Exporting data to JSON...');
  
  if (funds.length === 0) {
    throw new Error('No funds data to export');
  }

  const jsonData = JSON.stringify(funds, null, 2);
  const finalFilename = generateFilename(filename, 'json', includeTimestamp);

  try {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined') {
      // Browser environment - create downloadable file
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = finalFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      console.log(`✅ JSON download initiated: ${finalFilename}`);
      return finalFilename;
    } else {
      // Node.js environment - write to file system
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Ensure directory exists
      const dir = path.dirname(finalFilename);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(finalFilename, jsonData);
      console.log(`✅ JSON exported to ${finalFilename}`);
      return finalFilename;
    }
  } catch (error) {
    console.error('❌ Failed to export JSON:', error);
    throw new Error(`Failed to export JSON: ${error}`);
  }
};

/**
 * Write the published dataset (public/data/funds.json) when running under Node,
 * or refresh the browser cache when running in a tab.
 *
 * The Node branch is the one that matters: that file is what gets committed and
 * served, and is the app's primary data source.
 */
export const updateLocalCache = async (funds: MutualFund[]): Promise<void> => {
  if (typeof window !== 'undefined') {
    await setLocalCache(FUNDS_CACHE_KEY, funds);
    console.log('✅ Browser cache refreshed');
    return;
  }

  const dataset: FundDataset = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    count: funds.length,
    funds,
  };

  const target = `public/${DATASET_PATH}`;

  try {
    const fs = await import('fs/promises');
    const path = await import('path');

    await fs.mkdir(path.dirname(target), { recursive: true });
    // No pretty-printing: this file ships to clients, and indentation roughly
    // doubles it before gzip.
    await fs.writeFile(target, JSON.stringify(dataset));

    const { size } = await fs.stat(target);
    console.log(
      `✅ Wrote ${target} — ${funds.length} funds, ${(size / 1024 / 1024).toFixed(2)} MB`,
    );
  } catch (error) {
    // A failure here means the app will fall back to Firestore, which works but
    // costs reads — so make it loud rather than swallowing it.
    console.error(`❌ Failed to write ${target}:`, error);
    throw error;
  }
};

/**
 * Generate filename with optional timestamp
 */
const generateFilename = (base: string, extension: string, includeTimestamp: boolean): string => {
  const folder = '__generated__';

  if (!includeTimestamp) {
    return `${folder}/${base}.${extension}`;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `${folder}/${base}_${timestamp}.${extension}`;
};

/**
 * Get export summary
 */
export const getExportSummary = (funds: MutualFund[]): {
  totalFunds: number;
  categories: Record<string, number>;
  avgAUM: number;
  topFundHouses: Array<{ name: string; count: number }>;
} => {
  const categories: Record<string, number> = {};
  const fundHouses: Record<string, number> = {};
  let totalAUM = 0;
  let aumCount = 0;

  funds.forEach(fund => {
    // Count categories
    categories[fund.category] = (categories[fund.category] || 0) + 1;
    
    // Count fund houses
    fundHouses[fund.fundHouse] = (fundHouses[fund.fundHouse] || 0) + 1;
    
    // Calculate average AUM
    if (fund.aum && fund.aum > 0) {
      totalAUM += fund.aum;
      aumCount++;
    }
  });

  // Get top 5 fund houses
  const topFundHouses = Object.entries(fundHouses)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalFunds: funds.length,
    categories,
    avgAUM: aumCount > 0 ? totalAUM / aumCount : 0,
    topFundHouses,
  };
};
