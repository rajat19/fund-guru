/**
 * A small delimited-text reader, for files a user picks off their own machine.
 *
 * Why not `csv-parse`, which is already a dependency? It is only used by the
 * sync CLI, which runs in Node. Pulling its browser build into the app bundle to
 * read one file on one page would put ~30 KB in front of every visit, and this
 * app deliberately keeps holdings data out of the main payload for the same
 * reason. The subset of RFC 4180 that broker exports actually use is small
 * enough to implement honestly and test properly.
 *
 * What it handles, because real exports contain all of it:
 *  - a UTF-8 BOM, which Excel writes and which otherwise corrupts the first header
 *  - CRLF, LF and bare CR line endings
 *  - quoted fields containing the delimiter, a newline, or an escaped `""` quote
 *  - comma, semicolon, tab or pipe delimiters, detected rather than assumed
 *  - preamble and blank rows, which the caller skips using the field counts
 */

export const DELIMITERS = [',', ';', '\t', '|'] as const;

export type Delimiter = (typeof DELIMITERS)[number];

/** Strip the BOM and normalise line endings so the scanner sees only '\n'. */
const normalise = (text: string): string =>
  // Written as an escape: a literal BOM is invisible in source.
  text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

/**
 * Split one already-normalised document on a known delimiter.
 *
 * A hand-rolled scanner rather than a regex or `split`: a quoted field may
 * contain the delimiter *and* a newline, so neither line-splitting first nor
 * field-splitting first is correct. State has to be carried character by
 * character.
 */
const splitWith = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = () => {
    row.push(field.trim());
    field = '';
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      // A doubled quote inside a quoted field is a literal quote.
      if (text[i + 1] === '"') {
        field += '"';
        i += 1;
        continue;
      }
      quoted = false;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (char === '\n') {
      endRow();
      continue;
    }
    field += char;
  }

  // A trailing newline leaves nothing pending; anything else is a final row.
  if (field !== '' || row.length > 0) endRow();

  return rows;
};

/** True for a row that carries no content at all. */
export const isBlankRow = (row: string[]): boolean => row.every((cell) => cell === '');

/**
 * Pick the delimiter by parsing with each candidate and scoring the result.
 *
 * Counting raw occurrences is the obvious approach and it is wrong: a scheme
 * name like "Aditya Birla Sun Life Equity Hybrid '95 Fund, Direct Growth" puts
 * commas inside quoted fields, and an Indian rupee figure puts them inside
 * numbers. Only a full parse knows which separators were structural.
 *
 * The score rewards the delimiter that yields the most columns *consistently* —
 * a wrong delimiter typically produces one column, or a ragged table.
 */
export const detectDelimiter = (text: string): Delimiter => {
  const normalised = normalise(text);
  let best: { delimiter: Delimiter; score: number } = { delimiter: ',', score: -1 };

  for (const delimiter of DELIMITERS) {
    const rows = splitWith(normalised, delimiter).filter((row) => !isBlankRow(row));
    if (rows.length === 0) continue;

    // Modal field count, and how much of the file agrees with it.
    const counts = new Map<number, number>();
    for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);

    let modalWidth = 1;
    let modalRows = 0;
    for (const [width, seen] of counts) {
      if (seen > modalRows || (seen === modalRows && width > modalWidth)) {
        modalWidth = width;
        modalRows = seen;
      }
    }

    if (modalWidth < 2) continue;

    const consistency = modalRows / rows.length;
    const score = modalWidth * consistency;

    if (score > best.score) best = { delimiter, score };
  }

  return best.delimiter;
};

export interface CsvDocument {
  rows: string[][];
  delimiter: Delimiter;
  /** Row index in the original file, so errors can cite a line number. */
  lineNumbers: number[];
}

/**
 * Parse delimited text into rows, dropping blank lines but remembering which
 * physical line each surviving row came from.
 */
export const parseCsv = (text: string, delimiter?: Delimiter): CsvDocument => {
  const chosen = delimiter ?? detectDelimiter(text);
  const all = splitWith(normalise(text), chosen);

  const rows: string[][] = [];
  const lineNumbers: number[] = [];

  all.forEach((row, index) => {
    if (isBlankRow(row)) return;
    rows.push(row);
    lineNumbers.push(index + 1);
  });

  return { rows, delimiter: chosen, lineNumbers };
};

/** Serialise rows back to CSV, quoting only what needs it. */
export const toCsv = (rows: string[][]): string =>
  rows
    .map((row) =>
      row
        .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(','),
    )
    .join('\n');
