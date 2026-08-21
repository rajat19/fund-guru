import { useCallback, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileUp,
  Info,
  Loader2,
  Play,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { MutualFund } from '@/types/mutualFund';
import {
  importMfHoldings,
  importMfTables,
  importSipHoldings,
  importSipTables,
  mergeMfHoldings,
  mergeSipHoldings,
  tablesFromSheets,
  templateCsv,
  upsertFiles,
  type ImportKind,
  type ImportReport,
  type MergeOutcome,
} from '@/utils/holdingsImport';
import { buildFundMatchIndex, type FundMatchIndex } from '@/utils/fundMatch';
import { isXlsxFilename, readXlsx } from '@/utils/xlsx';
import type { MfHolding, SipHolding } from '@/types/userHoldings';
import { formatCurrency } from '@/utils/format';

/**
 * Stage every file, then generate the analysis once.
 *
 * Files are read and validated as they are picked — column mapping, skipped rows
 * and per-file errors are feedback about the *file*, and withholding that until
 * the end would make a bad upload hard to attribute. But nothing reaches the
 * analysis until the user presses Generate.
 *
 * That split is not just about saving work. Portfolio-level figures — allocation,
 * AMC concentration, overlap, ranking — are only meaningful over a *complete*
 * portfolio. Recomputing as each file lands would put "62% of your portfolio is
 * with one fund house" on screen when two of three accounts have been read, which
 * is a confident, wrong, actionable number. One deterministic transition avoids
 * ever rendering a half-portfolio verdict.
 *
 * The two kinds stay independent — plenty of people have holdings and no SIPs, or
 * the reverse, and either alone says something useful.
 */

/** Files above this are not a holdings statement, and reading one blocks the tab. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface LoadedFile<T> {
  name: string;
  report: ImportReport<T> | null;
  /** Set when the file could not be read at all. */
  error: string | null;
}

interface Staging<T> {
  files: Array<LoadedFile<T>>;
  merged: MergeOutcome<T>;
  isReading: boolean;
  add: (picked: FileList) => Promise<void>;
  removeFile: (name: string) => void;
  removeAll: () => void;
}

/**
 * Reading and holding files for one kind, without publishing anything.
 *
 * A ref mirrors the list because `add` awaits the file reads before folding the
 * result in; reading the list out of the render closure would use a snapshot from
 * before the read began and drop rows from an earlier batch.
 */
const useStagedFiles = <T,>(
  matchIndex: FundMatchIndex,
  importTables: (tables: ReturnType<typeof tablesFromSheets>, index: FundMatchIndex) => ImportReport<T>,
  importCsv: (text: string, index: FundMatchIndex, label: string) => ImportReport<T>,
  merge: (rows: T[]) => MergeOutcome<T>,
  onStagingChanged: () => void,
): Staging<T> => {
  const [files, setFiles] = useState<Array<LoadedFile<T>>>([]);
  const [isReading, setIsReading] = useState(false);
  const filesRef = useRef<Array<LoadedFile<T>>>([]);

  const apply = useCallback(
    (next: Array<LoadedFile<T>>) => {
      filesRef.current = next;
      setFiles(next);
      onStagingChanged();
    },
    [onStagingChanged],
  );

  const readOne = useCallback(
    async (file: File): Promise<LoadedFile<T>> => {
      if (file.size > MAX_FILE_BYTES) {
        return {
          name: file.name,
          report: null,
          error: `${(file.size / 1024 / 1024).toFixed(1)} MB is far larger than any holdings statement — this looks like the wrong file.`,
        };
      }

      try {
        if (isXlsxFilename(file.name)) {
          const sheets = await readXlsx(await file.arrayBuffer());
          return {
            name: file.name,
            report: importTables(tablesFromSheets(sheets, file.name), matchIndex),
            error: null,
          };
        }

        return {
          name: file.name,
          report: importCsv(await file.text(), matchIndex, file.name),
          error: null,
        };
      } catch (cause) {
        return {
          name: file.name,
          report: null,
          error:
            // Pass through the messages that already say something actionable —
            // an .xls file, a browser without DecompressionStream, a non-zip.
            cause instanceof Error && /worksheet|zip|browser cannot/i.test(cause.message)
              ? cause.message
              : 'Could not read this file. If it is a PDF or an older .xls workbook, export it as .xlsx or CSV first.',
        };
      }
    },
    [matchIndex, importTables, importCsv],
  );

  const add = useCallback(
    async (picked: FileList) => {
      setIsReading(true);
      try {
        const loaded: Array<LoadedFile<T>> = [];
        for (const file of Array.from(picked)) {
          loaded.push(await readOne(file));
        }
        // Re-picking a file replaces its previous load rather than duplicating it.
        apply(upsertFiles(filesRef.current, loaded));
      } finally {
        setIsReading(false);
      }
    },
    [apply, readOne],
  );

  const merged = useMemo(
    () => merge(files.flatMap((file) => file.report?.rows ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files],
  );

  return {
    files,
    merged,
    isReading,
    add,
    removeFile: (name: string) =>
      apply(filesRef.current.filter((file) => file.name !== name)),
    removeAll: () => apply([]),
  };
};

interface PaneProps<T> {
  kind: ImportKind;
  title: string;
  description: string;
  staging: Staging<T>;
}

const downloadTemplate = (kind: ImportKind) => {
  const blob = new Blob([templateCsv(kind)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = kind === 'mf' ? 'holdings-template.csv' : 'sip-template.csv';
  link.click();
  URL.revokeObjectURL(url);
};

/** Presentational: the staged file list for one kind, and what was read from it. */
function ImportPane<T extends { sourceFile: string | null }>({
  kind,
  title,
  description,
  staging,
}: PaneProps<T>) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { files, merged, isReading } = staging;

  const totalRows = merged.rows.length;
  const allSkipped = files.flatMap((file) =>
    (file.report?.skipped ?? []).map((row) => ({ ...row, file: file.name })),
  );
  const allWarnings = [...new Set(files.flatMap((file) => file.report?.warnings ?? []))];
  const skippedValue = allSkipped.reduce((sum, row) => sum + (row.amount ?? 0), 0);

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        {totalRows > 0 && (
          <Badge variant="secondary" className="shrink-0">
            {totalRows} row{totalRows === 1 ? '' : 's'}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={isReading}
          onChange={(event) => {
            if (event.target.files?.length) {
              void staging.add(event.target.files).finally(() => {
                // Reset so re-picking the same file fires a change event again.
                if (inputRef.current) inputRef.current.value = '';
              });
            }
          }}
        />
        <Button asChild variant="outline" size="sm" disabled={isReading}>
          <label htmlFor={inputId} className="cursor-pointer">
            {isReading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4 mr-2" />
            )}
            {files.length > 0 ? 'Add more files' : 'Choose files'}
          </label>
        </Button>

        <Button variant="ghost" size="sm" className="text-xs" onClick={() => downloadTemplate(kind)}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Template
        </Button>

        {files.length > 0 && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={staging.removeAll}>
            <X className="h-3.5 w-3.5 mr-1.5" />
            Remove all
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        CSV, TSV or .xlsx. Add as many as you need — one per account, or a file per family member.
      </p>

      {/* Per-file state, so a bad file is attributable and removable on its own. */}
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file) => (
            <li key={file.name} className="flex items-start justify-between gap-2 text-xs">
              <div className="flex gap-1.5 min-w-0">
                {file.error || file.report?.error ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-loss" />
                ) : (
                  <Check className="h-3.5 w-3.5 shrink-0 mt-0.5 text-profit" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium" title={file.name}>
                    {file.name}
                  </div>
                  <div className="text-muted-foreground">
                    {file.error ? (
                      <span className="text-loss">{file.error}</span>
                    ) : file.report?.error ? (
                      <span className="text-loss">{file.report.error}</span>
                    ) : (
                      <>
                        {file.report?.rows.length ?? 0} row
                        {(file.report?.rows.length ?? 0) === 1 ? '' : 's'}
                        {(file.report?.skipped.length ?? 0) > 0 && (
                          <> · {file.report!.skipped.length} skipped</>
                        )}
                        {file.report?.rows[0]?.sourceFile?.includes('›') && (
                          <> · sheet {file.report.rows[0].sourceFile!.split('›')[1]?.trim()}</>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                aria-label={`Remove ${file.name}`}
                onClick={() => staging.removeFile(file.name)}
              >
                <X className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 1 && merged.duplicatesDropped > 0 && (
        <div className="text-xs text-muted-foreground flex gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            {merged.duplicatesDropped} row{merged.duplicatesDropped === 1 ? '' : 's'} appeared
            identically in more than one file and will be counted once.
          </span>
        </div>
      )}

      {/* Contradictions between files. Not resolved automatically: summing would
          invent money and picking silently would hide a restatement. */}
      {merged.conflicts.length > 0 && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-1.5 text-xs">
          <div className="flex gap-2 text-amber-800 dark:text-amber-300 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {merged.conflicts.length} position{merged.conflicts.length === 1 ? '' : 's'} appear in
              two files with different figures — probably the same account stated twice
            </span>
          </div>
          <ul className="space-y-1 pl-5 text-amber-800/90 dark:text-amber-300/90">
            {merged.conflicts.slice(0, 6).map((conflict) => (
              <li key={conflict.description + conflict.droppedFrom}>
                {conflict.description}: will use the figures from{' '}
                <span className="font-medium">{conflict.keptFrom}</span> and ignore{' '}
                <span className="font-medium">{conflict.droppedFrom}</span>.
              </li>
            ))}
            {merged.conflicts.length > 6 && <li>…and {merged.conflicts.length - 6} more.</li>}
          </ul>
          <p className="pl-5 text-amber-800/90 dark:text-amber-300/90">
            Remove whichever file is the older statement before generating. They are not added
            together — that would count the same money twice.
          </p>
        </div>
      )}

      {allSkipped.length > 0 && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-1.5 text-xs">
          <div className="flex gap-2 text-amber-800 dark:text-amber-300 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Skipping {allSkipped.length} row{allSkipped.length === 1 ? '' : 's'}
              {skippedValue > 0 && <> holding {formatCurrency(skippedValue)}</>} — these will be
              excluded from every figure.
            </span>
          </div>
          <ul className="space-y-1 pl-5 text-amber-800/90 dark:text-amber-300/90">
            {allSkipped.slice(0, 8).map((row) => (
              <li key={`${row.file}-${row.line}-${row.name}`}>
                <span className="font-mono">
                  {row.file} line {row.line}
                </span>
                {row.name && <> · {row.name}</>} — {row.detail}
              </li>
            ))}
            {allSkipped.length > 8 && <li>…and {allSkipped.length - 8} more.</li>}
          </ul>
        </div>
      )}

      {/* Which headers were understood, so a mis-mapped column is visible. */}
      {files.some((file) => file.report && !file.report.error) && (
        <div className="space-y-1.5 text-xs">
          {files
            .filter((file) => file.report && !file.report.error)
            .map((file) => (
              <div key={file.name} className="space-y-1">
                {files.length > 1 && (
                  <div className="text-muted-foreground truncate">{file.name}</div>
                )}
                <div className="flex flex-wrap gap-1">
                  {Object.entries(file.report!.recognisedColumns).map(([column, header]) => (
                    <Badge key={column} variant="outline" className="font-normal text-[11px]">
                      {header} → {column}
                    </Badge>
                  ))}
                </div>
                {file.report!.unrecognisedColumns.length > 0 && (
                  <p className="text-muted-foreground">
                    Ignored {file.report!.unrecognisedColumns.length} unrecognised column
                    {file.report!.unrecognisedColumns.length === 1 ? '' : 's'}:{' '}
                    {file.report!.unrecognisedColumns.slice(0, 6).join(', ')}
                    {file.report!.unrecognisedColumns.length > 6 && '…'}
                  </p>
                )}
              </div>
            ))}
        </div>
      )}

      {allWarnings.map((warning) => (
        <div key={warning} className="flex gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  );
}

interface HoldingsImporterProps {
  universe: MutualFund[];
  /** Called once, on Generate, with everything staged. */
  onGenerate: (mf: MfHolding[], sips: SipHolding[]) => void;
  /** True when an analysis is already on screen, so the button can say "update". */
  hasAnalysis: boolean;
}

export function HoldingsImporter({ universe, onGenerate, hasAnalysis }: HoldingsImporterProps) {
  // Building the match index over ~1,500 funds is not free; do it once per
  // universe rather than once per uploaded row.
  const matchIndex = useMemo(() => buildFundMatchIndex(universe), [universe]);

  /**
   * Whether staging has moved on since the last Generate.
   *
   * Drives a *hint* only, never the button's enabled state. Greying out a button
   * because "nothing changed" forces the user to work out why it is dead, and it
   * created a real dead-end: removing a row from the results left them unable to
   * regenerate from the files still sitting in front of them. Re-running is cheap
   * and idempotent, so the button stays available whenever there is something to
   * run.
   */
  const [isStale, setIsStale] = useState(false);
  const markStale = useCallback(() => setIsStale(true), []);

  const mf = useStagedFiles<MfHolding>(
    matchIndex,
    (tables, index) => importMfTables(tables, index),
    (text, index, label) => importMfHoldings(text, index, new Date(), label),
    mergeMfHoldings,
    markStale,
  );

  const sips = useStagedFiles<SipHolding>(
    matchIndex,
    (tables, index) => importSipTables(tables, index),
    (text, index, label) => importSipHoldings(text, index, new Date(), label),
    mergeSipHoldings,
    markStale,
  );

  const stagedFiles = mf.files.length + sips.files.length;
  const mfRows = mf.merged.rows.length;
  const sipRows = sips.merged.rows.length;
  const isReading = mf.isReading || sips.isReading;

  const generate = () => {
    onGenerate(mf.merged.rows, sips.merged.rows);
    setIsStale(false);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ImportPane<MfHolding>
          kind="mf"
          title="Mutual fund holdings"
          description="Units you already own. Needs a scheme name plus a value, a cost, or units and NAV. A purchase date is what makes exit load and capital gains computable."
          staging={mf}
        />

        <ImportPane<SipHolding>
          kind="sip"
          title="SIP holdings"
          description="Instalment plans still running. Needs a scheme name and an amount per instalment; a frequency column is what makes an annual total possible."
          staging={sips}
        />
      </div>

      <Separator />

      {/* The single deterministic transition from "files picked" to "analysed". */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {stagedFiles === 0 ? (
            <>Add your files above. Nothing is analysed until you press Generate.</>
          ) : (
            <>
              {stagedFiles} file{stagedFiles === 1 ? '' : 's'} staged ·{' '}
              {mfRows} holding{mfRows === 1 ? '' : 's'} and {sipRows} SIP{sipRows === 1 ? '' : 's'}{' '}
              ready
              {isStale && hasAnalysis && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' '}
                  · the analysis below is out of date
                </span>
              )}
            </>
          )}
        </div>

        <Button
          onClick={generate}
          // Enabled whenever there is something to run: staged rows to analyse, or
          // an existing analysis that staging would now clear.
          disabled={isReading || (mfRows === 0 && sipRows === 0 && !hasAnalysis)}
          variant={isStale && hasAnalysis ? 'default' : hasAnalysis ? 'outline' : 'default'}
        >
          {isReading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          {hasAnalysis ? 'Regenerate analysis' : 'Generate analysis'}
        </Button>
      </div>
    </div>
  );
}
