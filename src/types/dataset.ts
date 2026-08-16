import { MutualFund } from '@/types/mutualFund';

/**
 * Shape of the published static dataset (public/data/funds.json).
 *
 * The whole fund universe is public, read-only and identical for every visitor,
 * so serving it as one CDN-cached file costs nothing. Reading it per-document
 * from Firestore costs one read per fund per cold client — roughly 3,000 reads
 * for a single first page load, which exhausts the free tier in about a dozen
 * visits. Firestore stays in the picture only as a fallback and for user data.
 */
export interface FundDataset {
  /** Bump alongside cache SCHEMA_VERSION when MutualFund changes shape. */
  schemaVersion: number;
  /** ISO timestamp of the sync that produced this file. */
  generatedAt: string;
  count: number;
  funds: MutualFund[];
}

export const DATASET_SCHEMA_VERSION = 4;

/** Path relative to the Vite base, so it works under /fund-guru/ on Pages. */
export const DATASET_PATH = 'data/funds.json';

export const isFundDataset = (value: unknown): value is FundDataset =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as FundDataset).funds) &&
  typeof (value as FundDataset).generatedAt === 'string';
