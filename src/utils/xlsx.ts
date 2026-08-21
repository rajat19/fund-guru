/**
 * A minimal .xlsx reader: zip → sheets → rows of strings.
 *
 * Why hand-rolled rather than a library. SheetJS is the obvious choice, but the
 * version published to npm is 0.18.5 and carries known prototype-pollution
 * advisories; the fixed releases are only on the maintainer's own CDN, so `pnpm
 * add xlsx` installs the vulnerable one. ExcelJS is maintained but around a
 * megabyte, on a page this app otherwise keeps lean. What is actually needed here
 * is one direction (read), of one format, for a file the user picked — and the
 * platform now supplies the hard part: `DecompressionStream('deflate-raw')` does
 * the inflate, so what is left is the zip directory and a little XML.
 *
 * The awkward part of .xlsx is not the zip, it is that **dates are numbers**.
 * A "Purchase Date" column arrives as `45397`, and whether that is a date or a
 * quantity is recorded in the *style*, not the cell. So this reads `styles.xml`
 * too and converts serials only for cells whose number format is a date one.
 * Skipping that would turn every date column into a meaningless integer.
 */

/* ---------------------------------------------------------------------------
 * Zip
 * ------------------------------------------------------------------------- */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const STORED = 0;
const DEFLATED = 8;

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/**
 * Locate the end-of-central-directory record.
 *
 * Scanned backwards because a zip may carry a trailing comment of up to 64 KB,
 * so the record is not simply the last 22 bytes.
 */
const findEocd = (view: DataView): number => {
  const maxComment = 0xffff;
  const start = Math.max(0, view.byteLength - maxComment - 22);

  for (let offset = view.byteLength - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
};

const readCentralDirectory = (view: DataView, bytes: Uint8Array): ZipEntry[] => {
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('Not a zip archive.');

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;

    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.push({ name, compression, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
};

/**
 * True when the browser can inflate for us.
 *
 * `DecompressionStream` is what makes a dependency-free reader viable, and it is
 * also the one thing here that an older browser may not have (Safari gained it in
 * 16.4). Detected so the failure is a sentence the user can act on rather than
 * the generic "could not read this file".
 */
export const canReadXlsx = (): boolean => typeof DecompressionStream === 'function';

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  if (!canReadXlsx()) {
    throw new Error(
      'This browser cannot unzip spreadsheets. Save the file as CSV and upload that instead, or use a newer browser.',
    );
  }

  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'),
  );
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
};

/**
 * Read one entry's bytes.
 *
 * Sizes come from the central directory rather than the local header, because a
 * streamed zip writes zeros there and defers the real sizes to a trailing data
 * descriptor.
 */
const readEntry = async (
  entry: ZipEntry,
  view: DataView,
  bytes: Uint8Array,
): Promise<Uint8Array> => {
  const local = entry.localHeaderOffset;
  if (view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw new Error(`Corrupt archive entry: ${entry.name}`);
  }

  const nameLength = view.getUint16(local + 26, true);
  const extraLength = view.getUint16(local + 28, true);
  const start = local + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + entry.compressedSize);

  if (entry.compression === STORED) return raw;
  if (entry.compression === DEFLATED) return inflateRaw(raw);
  throw new Error(`Unsupported compression in ${entry.name}.`);
};

/* ---------------------------------------------------------------------------
 * XML
 * ------------------------------------------------------------------------- */

/**
 * Entity decoding, done by hand rather than with DOMParser.
 *
 * DOMParser is browser-only, and keeping this dependency-free means the reader
 * can be unit-tested against a real workbook in the Node test environment
 * instead of only in a browser.
 */
const decodeEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Ampersand last, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, '&');

const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match ? decodeEntities(match[1]) : null;
};

/** Concatenated text of every `<t>` inside a fragment, for rich-text runs. */
const textOf = (fragment: string): string => {
  let out = '';
  for (const match of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g)) {
    out += match[1] == null ? '' : decodeEntities(match[1]);
  }
  return out;
};

const parseSharedStrings = (xml: string): string[] => {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g)) {
    strings.push(match[1] == null ? '' : textOf(match[1]));
  }
  return strings;
};

/* ---------------------------------------------------------------------------
 * Dates
 * ------------------------------------------------------------------------- */

/**
 * Number format ids Excel reserves for dates and times.
 * @see ECMA-376 part 1, 18.8.30 (numFmt)
 */
const BUILT_IN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

/**
 * Which style indices point at a date format.
 *
 * Two hops: `cellXfs` maps a cell's `s` attribute to a `numFmtId`, and that id is
 * either built-in or defined in `numFmts` with a format code. A custom code
 * counts as a date when it contains date placeholders outside a literal section —
 * `0.00` is not a date and `dd-mmm-yyyy` is.
 */
const parseDateStyles = (stylesXml: string): Set<number> => {
  const dateFormatIds = new Set(BUILT_IN_DATE_FORMATS);

  for (const match of stylesXml.matchAll(/<numFmt\s[^>]*\/>/g)) {
    const id = Number(attribute(match[0], 'numFmtId'));
    const code = attribute(match[0], 'formatCode') ?? '';
    if (!Number.isFinite(id)) continue;

    // Strip quoted literals and colour/condition sections before looking for
    // date letters, so a currency format with a quoted "d" is not a date.
    const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    if (/[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare)) dateFormatIds.add(id);
  }

  const dateStyles = new Set<number>();
  const cellXfs = /<cellXfs[\s\S]*?<\/cellXfs>/.exec(stylesXml)?.[0] ?? '';

  let index = 0;
  for (const match of cellXfs.matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number(attribute(match[0], 'numFmtId') ?? '0');
    if (dateFormatIds.has(id)) dateStyles.add(index);
    index += 1;
  }

  return dateStyles;
};

/**
 * Excel's day-zero is 1899-12-30, not 1900-01-01.
 *
 * The two-day gap is Excel's deliberate bug-compatibility with Lotus 1-2-3,
 * which treated 1900 as a leap year. Using 1900-01-01 puts every date two days
 * out, which is exactly the kind of error that silently moves a holding across a
 * capital gains boundary.
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** Serial to ISO `YYYY-MM-DD`, or null when it is not a plausible date. */
export const excelSerialToIso = (serial: number): string | null => {
  // Below 1 is a time-of-day fraction with no date; above ~2958465 is past 9999.
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;

  const date = new Date(EXCEL_EPOCH_MS + Math.floor(serial) * MS_PER_DAY);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

/* ---------------------------------------------------------------------------
 * Sheets
 * ------------------------------------------------------------------------- */

/** `A` → 0, `Z` → 25, `AA` → 26. Cells are sparse, so position matters. */
export const columnIndex = (reference: string): number => {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1] ?? '';
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
};

const parseSheet = (
  xml: string,
  sharedStrings: string[],
  dateStyles: Set<number>,
): string[][] => {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rowMatch[2] ?? '';
    const cells: string[] = [];

    for (const cellMatch of body.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] ?? '';
      const content = cellMatch[2] ?? '';

      const reference = attribute(attributes, 'r');
      const type = attribute(attributes, 't');
      const style = Number(attribute(attributes, 's') ?? '');

      const rawValue = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(content)?.[1] ?? null;

      let value = '';
      if (type === 's') {
        // Shared string: <v> holds an index into sharedStrings.
        const index = Number(rawValue);
        value = Number.isInteger(index) ? sharedStrings[index] ?? '' : '';
      } else if (type === 'inlineStr') {
        value = textOf(content);
      } else if (type === 'str') {
        value = rawValue == null ? '' : decodeEntities(rawValue);
      } else if (type === 'b') {
        value = rawValue === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'd') {
        // ISO 8601 date, already usable.
        value = rawValue == null ? '' : decodeEntities(rawValue);
      } else if (rawValue != null) {
        const numeric = Number(rawValue);
        const asDate =
          Number.isFinite(style) && dateStyles.has(style) ? excelSerialToIso(numeric) : null;
        value = asDate ?? decodeEntities(rawValue);
      }

      // Respect the cell reference: a sheet may skip empty columns entirely.
      const target = reference ? columnIndex(reference) : cells.length;
      while (cells.length < target) cells.push('');
      cells[target] = value.trim();
    }

    // Row numbers can skip too. Pad so a header's physical row survives.
    const rowNumber = Number(attribute(rowMatch[1] ?? '', 'r'));
    if (Number.isInteger(rowNumber) && rowNumber > 0) {
      while (rows.length < rowNumber - 1) rows.push([]);
      rows[rowNumber - 1] = cells;
    } else {
      rows.push(cells);
    }
  }

  return rows.map((row) => row ?? []);
};

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

/** Sheet names in workbook order, so a sheet can be labelled in the UI. */
const parseSheetNames = (workbookXml: string): string[] =>
  [...workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)]
    .map((match) => attribute(match[0], 'name') ?? '')
    .filter((name) => name !== '');

/** Numeric order, so sheet2 does not sort before sheet10 lexically. */
const sheetOrder = (name: string): number =>
  Number(/sheet(\d+)\.xml$/i.exec(name)?.[1] ?? Number.MAX_SAFE_INTEGER);

export const readXlsx = async (data: ArrayBuffer): Promise<XlsxSheet[]> => {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);

  const entries = readCentralDirectory(view, bytes);
  if (entries.length === 0) throw new Error('That file is empty or not a spreadsheet.');

  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const decoder = new TextDecoder();

  const textFor = async (name: string): Promise<string> => {
    const entry = byName.get(name);
    if (!entry) return '';
    return decoder.decode(await readEntry(entry, view, bytes));
  };

  const sheetEntries = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .sort((a, b) => sheetOrder(a.name) - sheetOrder(b.name));

  if (sheetEntries.length === 0) {
    throw new Error(
      'No worksheets found. If this is an .xls file (the older binary format), re-save it as .xlsx or CSV.',
    );
  }

  const [sharedStringsXml, stylesXml, workbookXml] = await Promise.all([
    textFor('xl/sharedStrings.xml'),
    textFor('xl/styles.xml'),
    textFor('xl/workbook.xml'),
  ]);

  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const dateStyles = parseDateStyles(stylesXml);
  const names = parseSheetNames(workbookXml);

  const sheets: XlsxSheet[] = [];
  for (const [index, entry] of sheetEntries.entries()) {
    const xml = decoder.decode(await readEntry(entry, view, bytes));
    sheets.push({
      name: names[index] ?? `Sheet ${index + 1}`,
      rows: parseSheet(xml, sharedStrings, dateStyles),
    });
  }

  return sheets;
};

export const isXlsxFilename = (name: string): boolean => /\.xlsx$/i.test(name);
