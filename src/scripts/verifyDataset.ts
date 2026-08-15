/**
 * CI guard for the published dataset.
 *
 * The app's primary data source is a committed JSON file. If a sync half-writes
 * it, or someone commits an old-schema version, the app silently falls back to
 * Firestore and starts burning read quota. This makes that a build failure
 * instead of a surprise on the billing page.
 *
 * Usage: pnpm verify:dataset [--max-age-days 30]
 */

import fs from 'fs/promises';
import path from 'path';
import { DATASET_PATH, DATASET_SCHEMA_VERSION, isFundDataset } from '@/types/dataset';
import {
  HOLDINGS_PATH,
  HOLDINGS_SCHEMA_VERSION,
  isHoldingsDataset,
} from '@/types/holdings';

const DEFAULT_MAX_AGE_DAYS = 45;

const fail = (message: string): never => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

/**
 * Holdings power overlap analysis in the builder. Their absence is a warning, not
 * a failure: the builder still works, it just cannot tell whether two funds hold
 * the same things.
 */
async function verifyHoldings(fundCount: number): Promise<void> {
  const target = path.resolve(process.cwd(), 'public', HOLDINGS_PATH);

  let raw: string;
  try {
    raw = await fs.readFile(target, 'utf-8');
  } catch {
    console.warn(
      `⚠️ ${HOLDINGS_PATH} is missing — overlap analysis will be unavailable. Re-run \`pnpm sync:data\`.`,
    );
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(`${target} is not valid JSON.`);
  }

  if (!isHoldingsDataset(parsed)) {
    return fail(`${target} is not a recognised holdings dataset.`);
  }

  if (parsed.schemaVersion !== HOLDINGS_SCHEMA_VERSION) {
    return fail(
      `${target} has schemaVersion ${parsed.schemaVersion}, expected ${HOLDINGS_SCHEMA_VERSION}.`,
    );
  }

  const entries = Object.values(parsed.funds);
  const empty = entries.filter((e) => !e.holdings || e.holdings.length === 0).length;
  if (empty > 0) return fail(`${empty} holdings entries have no holdings.`);

  const covered = (entries.length / Math.max(1, fundCount)) * 100;
  const sizeMb = Buffer.byteLength(raw) / 1024 / 1024;
  console.log(
    `✅ ${HOLDINGS_PATH}: ${entries.length} funds (${covered.toFixed(0)}% of the universe), ${sizeMb.toFixed(2)} MB`,
  );

  if (covered < 50) {
    console.warn(`⚠️ Only ${covered.toFixed(0)}% of funds have holdings — overlap checks will be partial.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const maxAgeIndex = args.indexOf('--max-age-days');
  const maxAgeDays =
    maxAgeIndex !== -1 && args[maxAgeIndex + 1]
      ? Number(args[maxAgeIndex + 1])
      : DEFAULT_MAX_AGE_DAYS;

  const target = path.resolve(process.cwd(), 'public', DATASET_PATH);

  let raw: string;
  try {
    raw = await fs.readFile(target, 'utf-8');
  } catch {
    return fail(
      `${target} is missing. Run \`pnpm sync:data\` locally and commit the result.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fail(`${target} is not valid JSON: ${error}`);
  }

  if (!isFundDataset(parsed)) {
    return fail(
      `${target} is not a dataset envelope. Expected { schemaVersion, generatedAt, count, funds }.`,
    );
  }

  if (parsed.schemaVersion !== DATASET_SCHEMA_VERSION) {
    return fail(
      `${target} has schemaVersion ${parsed.schemaVersion}, but the app expects ${DATASET_SCHEMA_VERSION}. Re-run the sync.`,
    );
  }

  if (parsed.funds.length === 0) {
    return fail(`${target} contains no funds.`);
  }

  if (parsed.count !== parsed.funds.length) {
    return fail(
      `${target} count field says ${parsed.count} but contains ${parsed.funds.length} funds.`,
    );
  }

  const generatedAt = new Date(parsed.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) {
    return fail(`${target} has an unparseable generatedAt: ${parsed.generatedAt}`);
  }

  const ageDays = (Date.now() - generatedAt.getTime()) / 86_400_000;
  if (ageDays > maxAgeDays) {
    return fail(
      `${target} was generated ${ageDays.toFixed(0)} days ago (limit ${maxAgeDays}). Re-run \`pnpm sync:data\`.`,
    );
  }

  // A fund with no scheme name or id is unusable downstream, and indicates the
  // Groww response shape shifted under us.
  const malformed = parsed.funds.filter((fund) => !fund?.id || !fund?.schemeName);
  if (malformed.length > 0) {
    return fail(`${malformed.length} funds are missing an id or schemeName.`);
  }

  const withOneYear = parsed.funds.filter((fund) => fund.returns?.oneYear != null).length;
  const coverage = (withOneYear / parsed.funds.length) * 100;

  // Fields the investment builder depends on. Absent means the file predates
  // them and needs a re-sync — a warning rather than a failure, since the
  // builder degrades to sub-category diversification without them.
  const withMinimum = parsed.funds.filter((fund) => fund.minInvestment != null).length;
  if (withMinimum === 0) {
    console.warn(
      '⚠️ No fund reports a minimum investment. Re-run `pnpm sync:data` so the builder can respect scheme minimums.',
    );
  }

  await verifyHoldings(parsed.funds.length);

  const sizeMb = Buffer.byteLength(raw) / 1024 / 1024;
  console.log(
    `✅ ${DATASET_PATH}: ${parsed.funds.length} funds, ${sizeMb.toFixed(2)} MB, ` +
      `generated ${ageDays.toFixed(1)} days ago, 1Y return coverage ${coverage.toFixed(1)}%`,
  );

  // Not fatal — a young universe legitimately lacks history — but worth seeing.
  if (coverage < 50) {
    console.warn(`⚠️ Only ${coverage.toFixed(1)}% of funds have a 1Y return. Sync may be partial.`);
  }
}

main().catch((error) => {
  console.error('verify:dataset failed:', error);
  process.exit(1);
});
