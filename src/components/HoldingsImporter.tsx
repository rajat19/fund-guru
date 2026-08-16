import { useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, FileUp, Info, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MutualFund } from '@/types/mutualFund';
import {
  importMfHoldings,
  importSipHoldings,
  templateCsv,
  type ImportKind,
  type ImportReport,
} from '@/utils/holdingsImport';
import { buildFundMatchIndex } from '@/utils/fundMatch';
import type { MfHolding, SipHolding } from '@/types/userHoldings';
import { formatCurrency } from '@/utils/format';

/**
 * One upload pane per file kind.
 *
 * The two are independent on purpose — plenty of people have a holdings export
 * and no SIP export, or the reverse, and either alone is enough to say something
 * useful. Neither waits for the other.
 *
 * Most of this component is the *report*, not the upload. Column matching and
 * name matching both guess, and a guess the user cannot see is a guess they
 * cannot correct: which headers were understood, which rows were dropped and why,
 * and how much money those rows carried all have to be on screen. A silently
 * short import would have every percentage on the page look like it covered the
 * whole portfolio.
 */

/** Files above this are not a holdings statement, and reading one blocks the tab. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface PaneProps {
  kind: ImportKind;
  title: string;
  description: string;
  universe: MutualFund[];
  rowCount: number;
  onImported: (report: ImportReport<MfHolding> | ImportReport<SipHolding>) => void;
  onClear: () => void;
  disabled?: boolean;
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

function ImportPane({
  kind,
  title,
  description,
  universe,
  rowCount,
  onImported,
  onClear,
  disabled,
}: PaneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport<MfHolding> | ImportReport<SipHolding> | null>(
    null,
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  // Building the match index over ~1,500 funds is not free; do it once per
  // universe rather than once per uploaded row.
  const matchIndex = useMemo(() => buildFundMatchIndex(universe), [universe]);

  const handleFile = async (file: File) => {
    setReadError(null);

    if (file.size > MAX_FILE_BYTES) {
      setReadError(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. A holdings statement is a few kilobytes — this looks like the wrong file.`,
      );
      return;
    }

    setIsReading(true);
    setFileName(file.name);

    try {
      const text = await file.text();
      const next =
        kind === 'mf'
          ? importMfHoldings(text, matchIndex)
          : importSipHoldings(text, matchIndex);

      setReport(next);
      onImported(next);
    } catch {
      setReadError('That file could not be read. If it is a PDF or an Excel workbook, export it as CSV first.');
    } finally {
      setIsReading(false);
      // Reset the input so re-picking the same file fires a change event again.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const clear = () => {
    setReport(null);
    setFileName(null);
    setReadError(null);
    onClear();
  };

  const skippedValue = (report?.skipped ?? []).reduce((sum, row) => sum + (row.amount ?? 0), 0);

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        {rowCount > 0 && (
          <Badge variant="secondary" className="shrink-0">
            {rowCount} row{rowCount === 1 ? '' : 's'}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          className="sr-only"
          disabled={disabled || isReading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button asChild variant="outline" size="sm" disabled={disabled || isReading}>
          <label htmlFor={inputId} className="cursor-pointer">
            {isReading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4 mr-2" />
            )}
            {rowCount > 0 ? 'Replace file' : 'Choose CSV'}
          </label>
        </Button>

        <Button variant="ghost" size="sm" className="text-xs" onClick={() => downloadTemplate(kind)}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Template
        </Button>

        {rowCount > 0 && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={clear}>
            <X className="h-3.5 w-3.5 mr-1.5" />
            Remove
          </Button>
        )}
      </div>

      {fileName && !readError && (
        <p className="text-xs text-muted-foreground truncate" title={fileName}>
          {fileName}
        </p>
      )}

      {readError && (
        <div className="flex gap-2 text-xs text-loss">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{readError}</span>
        </div>
      )}

      {report?.error && (
        <div className="rounded-md border border-loss/40 bg-loss/5 p-3 flex gap-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-loss" />
          <span>{report.error}</span>
        </div>
      )}

      {report && !report.error && (
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center gap-1.5 text-profit">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>
              Read {report.rows.length} row{report.rows.length === 1 ? '' : 's'} from{' '}
              {Object.keys(report.recognisedColumns).length} recognised column
              {Object.keys(report.recognisedColumns).length === 1 ? '' : 's'}.
            </span>
          </div>

          {/* What was actually understood, so a mis-mapped column is visible. */}
          <div className="flex flex-wrap gap-1">
            {Object.entries(report.recognisedColumns).map(([column, header]) => (
              <Badge key={column} variant="outline" className="font-normal text-[11px]">
                {header} → {column}
              </Badge>
            ))}
          </div>

          {report.unrecognisedColumns.length > 0 && (
            <p className="text-muted-foreground">
              Ignored {report.unrecognisedColumns.length} column
              {report.unrecognisedColumns.length === 1 ? '' : 's'} it did not recognise:{' '}
              {report.unrecognisedColumns.slice(0, 6).join(', ')}
              {report.unrecognisedColumns.length > 6 && '…'}
            </p>
          )}

          {report.skipped.length > 0 && (
            <div className="rounded-md border border-amber-300/50 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-1.5">
              <div className="flex gap-2 text-amber-800 dark:text-amber-300 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Skipped {report.skipped.length} row
                  {report.skipped.length === 1 ? '' : 's'}
                  {skippedValue > 0 && <> holding {formatCurrency(skippedValue)}</>} — excluded from
                  every figure below.
                </span>
              </div>
              <ul className="space-y-1 pl-5 text-amber-800/90 dark:text-amber-300/90">
                {report.skipped.slice(0, 8).map((row) => (
                  <li key={`${row.line}-${row.name}`}>
                    <span className="font-mono">Line {row.line}</span>
                    {row.name && <> · {row.name}</>} — {row.detail}
                  </li>
                ))}
                {report.skipped.length > 8 && <li>…and {report.skipped.length - 8} more.</li>}
              </ul>
            </div>
          )}

          {report.warnings.map((warning) => (
            <div key={warning} className="flex gap-2 text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface HoldingsImporterProps {
  universe: MutualFund[];
  mfCount: number;
  sipCount: number;
  onMfImported: (rows: MfHolding[]) => void;
  onSipImported: (rows: SipHolding[]) => void;
  disabled?: boolean;
}

export function HoldingsImporter({
  universe,
  mfCount,
  sipCount,
  onMfImported,
  onSipImported,
  disabled,
}: HoldingsImporterProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ImportPane
        kind="mf"
        title="Mutual fund holdings"
        description="Units you already own. Needs a scheme name plus a value, a cost, or units and NAV. A purchase date is what makes exit load and capital gains computable."
        universe={universe}
        rowCount={mfCount}
        onImported={(report) => onMfImported(report.rows as MfHolding[])}
        onClear={() => onMfImported([])}
        disabled={disabled}
      />

      <ImportPane
        kind="sip"
        title="SIP holdings"
        description="Instalment plans still running. Needs a scheme name and an amount per instalment; a frequency column is what makes an annual total possible."
        universe={universe}
        rowCount={sipCount}
        onImported={(report) => onSipImported(report.rows as SipHolding[])}
        onClear={() => onSipImported([])}
        disabled={disabled}
      />
    </div>
  );
}
