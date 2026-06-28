import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  Timestamp,
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MutualFund } from '@/types/mutualFund';
import { getLocalCache, setLocalCache } from '@/utils/cache';

const FUNDS_COLLECTION = 'mutual_funds';
const METADATA_COLLECTION = 'metadata';

export interface FirebaseMetadata {
  lastUpdated: Date;
  totalFunds: number;
  lastSyncStatus: 'success' | 'partial' | 'failed';
  syncErrors: string[];
}

/**
 * Ensures a fund document from Firebase has all required objects initialized
 * to prevent undefined property access crashes.
 */
const sanitizeFundData = (data: DocumentData): MutualFund => {
  // Convert Timestamp back to Date
  if (data.lastUpdated && typeof data.lastUpdated === 'object' && 'toDate' in data.lastUpdated) {
    data.lastUpdated = (data.lastUpdated as unknown as Timestamp).toDate();
  }
  
  // Ensure objects exist to prevent undefined property access
  if (!data.returns) data.returns = {};
  if (!data.ratios) data.ratios = {};
  if (!data.riskMetrics) data.riskMetrics = {};
  if (!data.portfolioMetrics) data.portfolioMetrics = {};
  if (!data.rankings) data.rankings = {};
  if (!data.categoryReturns) data.categoryReturns = {};
  if (!data.indexReturns) data.indexReturns = {};
  if (!data.sectors) data.sectors = {};
  if (!data.ratings) data.ratings = {};
  
  return data as MutualFund;
};

/**
 * Save multiple funds in batches
 */
export const saveFundsInBatches = async (
  funds: MutualFund[],
  batchSize: number = 500,
  onProgress?: (saved: number, total: number) => void,
  signal?: AbortSignal,
  isFullSync: boolean = false
): Promise<void> => {
  console.log(`🔄 Saving ${funds.length} funds to Firebase in batches of ${batchSize}...`);

  if (isFullSync) {
    console.log(`🧹 Full sync detected. Checking for stale funds to delete...`);
    try {
      const existingSnapshot = await getDocs(collection(db, FUNDS_COLLECTION));
      const existingIds = new Set(existingSnapshot.docs.map(d => d.id));
      
      // Remove all IDs that are present in the new payload
      funds.forEach(f => existingIds.delete(f.id));
      
      if (existingIds.size > 0) {
        console.log(`🗑️ Found ${existingIds.size} stale/replaced funds in Firebase. Deleting...`);
        const staleIds = Array.from(existingIds);
        for (let i = 0; i < staleIds.length; i += batchSize) {
          if (signal?.aborted) throw new Error('Sync cancelled by user');
          const batch = writeBatch(db);
          const currentBatchIds = staleIds.slice(i, i + batchSize);
          currentBatchIds.forEach(id => {
            batch.delete(doc(db, FUNDS_COLLECTION, id));
            console.log(`   - Deleted: ${id}`);
          });
          await batch.commit();
        }
      } else {
        console.log(`✨ No stale funds found in Firebase.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Sync cancelled by user') throw error;
      console.error(`❌ Failed to delete stale funds:`, error);
    }
  }

  let saved = 0;
  const errors: string[] = [];

  for (let i = 0; i < funds.length; i += batchSize) {
    if (signal?.aborted) {
      console.log('⚠️ Saving to Firebase cancelled by user.');
      throw new Error('Sync cancelled by user');
    }

    const batch = writeBatch(db);
    const currentBatch = funds.slice(i, i + batchSize);

    try {
      currentBatch.forEach((fund) => {
        const docRef = doc(db, FUNDS_COLLECTION, fund.id);
        const fundData = {
          ...fund,
          lastUpdated: Timestamp.fromDate(fund.lastUpdated ? new Date(fund.lastUpdated) : new Date()),
        };
        batch.set(docRef, fundData);
      });

      await batch.commit();
      saved += currentBatch.length;

      console.log(
        `✅ Saved batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(funds.length / batchSize)} (${saved}/${funds.length})`,
      );

      if (onProgress) {
        onProgress(saved, funds.length);
      }
    } catch (error) {
      const errorMsg = `Failed to save batch starting at index ${i}: ${error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  // Save metadata
  await saveMetadata({
    lastUpdated: new Date(),
    totalFunds: saved,
    lastSyncStatus: errors.length === 0 ? 'success' : saved > 0 ? 'partial' : 'failed',
    syncErrors: errors,
  });

  console.log(`🎉 Completed saving ${saved}/${funds.length} funds to Firebase`);

  if (errors.length > 0) {
    throw new Error(`Some batches failed to save. Errors: ${errors.join(', ')}`);
  }
};

/**
 * Get all funds
 */
export const getAllFunds = async (): Promise<MutualFund[]> => {
  // 1. Try Browser IndexedDB Cache FIRST (always the most up-to-date in browser)
  try {
    const cachedFunds = await getLocalCache<any[]>('all_mutual_funds');
    if (cachedFunds && cachedFunds.length > 0) {
      const funds = cachedFunds.map(sanitizeFundData);
      console.log(`✅ Retrieved ${funds.length} funds from browser IndexedDB cache`);
      return funds;
    }
  } catch (error) {
    console.log('⚠️ IndexedDB cache not available...');
  }

  // 2. Try local JSON dev cache SECOND (fallback for local development if IndexedDB is empty)
  try {
    if (typeof window !== 'undefined') {
      const response = await fetch('/data/funds-cache.json');
      if (response.ok) {
        const text = await response.text();
        if (text.trim().startsWith('[')) {
          const data = JSON.parse(text);
          const funds = data.map(sanitizeFundData);
          console.log(`✅ Retrieved ${funds.length} funds from local JSON dev cache`);
          // Populate IndexedDB for next time
          await setLocalCache('all_mutual_funds', funds).catch(console.error);
          return funds;
        }
      }
    }
  } catch (error) {
    // Ignore and fallback
  }

  // 3. Fallback to Firebase & Save to Cache
  try {
    console.log('🔍 Fetching all funds from Firebase...');
    const querySnapshot = await getDocs(collection(db, FUNDS_COLLECTION));

    const funds: MutualFund[] = [];
    querySnapshot.forEach((doc: QueryDocumentSnapshot<DocumentData>) => {
      funds.push(sanitizeFundData(doc.data()));
    });

    console.log(`✅ Retrieved ${funds.length} funds from Firebase`);
    
    // Save to IndexedDB for next time
    if (funds.length > 0) {
      await setLocalCache('all_mutual_funds', funds).catch(console.error);
    }
    
    return funds;
  } catch (error) {
    console.error('❌ Error fetching funds from Firebase:', error);
    throw error;
  }
};

/**
 * Get funds by category
 */
export const getFundsByCategory = async (category: string, limitCount: number = 100): Promise<MutualFund[]> => {
  try {
    const q = query(
      collection(db, FUNDS_COLLECTION),
      where('category', '==', category),
      limit(limitCount),
    );

    const querySnapshot = await getDocs(q);
    const funds: MutualFund[] = [];

    querySnapshot.forEach((doc) => {
      funds.push(sanitizeFundData(doc.data()));
    });

    return funds;
  } catch (error) {
    console.error(`❌ Error fetching ${category} funds:`, error);
    throw error;
  }
};

/**
 * Get single fund by ID
 */
export const getFundById = async (id: string): Promise<MutualFund | null> => {
  try {
    const docRef = doc(db, FUNDS_COLLECTION, id);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return sanitizeFundData(docSnap.data());
    }

    return null;
  } catch (error) {
    console.error(`❌ Error fetching fund ${id}:`, error);
    throw error;
  }
};

/**
 * Search funds
 */
export const searchFunds = async (searchTerm: string, limitCount: number = 50): Promise<MutualFund[]> => {
  try {
    // Note: This is a simple search. For better search, consider using Algolia or similar
    const querySnapshot = await getDocs(
      query(collection(db, FUNDS_COLLECTION), limit(limitCount * 2)),
    );

    const funds: MutualFund[] = [];
    const searchLower = searchTerm.toLowerCase();

    querySnapshot.forEach((doc) => {
      const data = doc.data() as MutualFund;

      // Simple text matching
      if (
        data.schemeName?.toLowerCase().includes(searchLower) ||
        data.fundName?.toLowerCase().includes(searchLower) ||
        data.fundHouse?.toLowerCase().includes(searchLower)
      ) {
        funds.push(sanitizeFundData(doc.data()));
      }
    });

    return funds.slice(0, limitCount);
  } catch (error) {
    console.error(`❌ Error searching funds:`, error);
    throw error;
  }
};

/**
 * Get top performing funds
 */
export const getTopPerformingFunds = async (limitCount: number = 10): Promise<MutualFund[]> => {
  try {
    // Note: Firestore doesn't support ordering by nested fields directly
    // We'll fetch more data and sort in memory
    const querySnapshot = await getDocs(query(collection(db, FUNDS_COLLECTION), limit(500)));

    const funds: MutualFund[] = [];

    querySnapshot.forEach((doc) => {
      funds.push(sanitizeFundData(doc.data()));
    });

    // Sort by 1-year returns (descending)
    return funds
      .filter((fund) => fund.returns.oneYear && fund.returns.oneYear > 0)
      .sort((a, b) => (b.returns.oneYear || 0) - (a.returns.oneYear || 0))
      .slice(0, limitCount);
  } catch (error) {
    console.error('❌ Error fetching top performing funds:', error);
    throw error;
  }
};

/**
 * Save metadata
 */
export const saveMetadata = async (metadata: FirebaseMetadata): Promise<void> => {
  try {
    const docRef = doc(db, METADATA_COLLECTION, 'sync_info');
    await setDoc(docRef, {
      ...metadata,
      lastUpdated: Timestamp.fromDate(metadata.lastUpdated),
    });
  } catch (error) {
    console.error('❌ Error saving metadata:', error);
    throw error;
  }
};

/**
 * Get metadata
 */
export const getMetadata = async (): Promise<FirebaseMetadata | null> => {
  try {
    const docRef = doc(db, METADATA_COLLECTION, 'sync_info');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        ...data,
        lastUpdated: data.lastUpdated.toDate(),
      } as FirebaseMetadata;
    }

    return null;
  } catch (error) {
    console.error('❌ Error fetching metadata:', error);
    throw error;
  }
};

/**
 * Check if data needs refresh (older than 1 day)
 */
export const shouldRefreshData = async (): Promise<boolean> => {
  const metadata = await getMetadata();
  if (!metadata) return true;

  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  return metadata.lastUpdated < oneDayAgo;
};
