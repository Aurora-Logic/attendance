import {
  EXPORT_FORMAT_EXTENSIONS,
  type ExportFormat,
  type FilterCaption,
  type ReportCellValue,
  type ReportColumnSpec,
  type ReportColumnType,
} from '@vyuha/shared';

/**
 * How a report becomes a file (REQ-J-03).
 *
 * The interface exists because the requirement is Excel and the API has no
 * spreadsheet library: CLAUDE.md §6 forbids adding a dependency without
 * asking, and this slice had no one to ask. CSV is written here; XLSX becomes
 * a second implementation of `ReportWriter` and one line in the factory, with
 * nothing above it changing.
 *
 * `supportsSheetFormatting` is the honest part. REQ-J-03 asks for a frozen
 * header row and set column widths, and a CSV cannot carry either. Rather than
 * quietly dropping half the requirement, the writer declares what it can do
 * and the export job records it on the audit row, so "why is the header not
 * frozen" has an answer that is not "nobody noticed".
 */

export interface ReportSheetMeta {
  /** REQ-J-03's header block. */
  readonly orgName: string;
  readonly reportLabel: string;
  readonly captions: readonly FilterCaption[];
  readonly generatedAt: Date;
  /** NFR-05: instants are stored in UTC and rendered in the org timezone. */
  readonly timezone: string;
  /** REQ-L-01's organisation date format. */
  readonly dateFormat: string;
  readonly rowCount: number;
}

export interface ReportWriter {
  readonly format: ExportFormat;
  readonly mime: string;
  readonly extension: string;
  /** REQ-J-03's frozen header and column widths. False for CSV. */
  readonly supportsSheetFormatting: boolean;
  begin(meta: ReportSheetMeta, columns: readonly ReportColumnSpec[]): void;
  writeRow(cells: readonly ReportCellValue[]): void;
  finish(): Buffer;
}

// ------------------------------------------------------------- cell rendering

const TWO_DIGITS = 2;

function pad(value: number): string {
  return String(value).padStart(TWO_DIGITS, '0');
}

/**
 * `HH:mm` or `HH:mm:ss` on the organisation's wall clock.
 *
 * `Intl.DateTimeFormat` rather than arithmetic on the offset: India is +05:30
 * and half-hour offsets are exactly where hand-rolled conversion goes wrong,
 * and a location that observes daylight saving would break the arithmetic
 * version twice a year in a file nobody re-reads.
 */
export function formatInstant(iso: string, timezone: string, withSeconds: boolean): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
    hour12: false,
  }).formatToParts(parsed);

  const at = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  const base = `${at('hour')}:${at('minute')}`;
  return withSeconds ? `${base}:${at('second')}` : base;
}

/**
 * A `YYYY-MM-DD` calendar date in the organisation's format (REQ-L-01).
 *
 * Two patterns are understood and anything else falls back to the stored form.
 * The alternative -- pulling in a formatting library on the server for one
 * column type -- is a dependency, and the two patterns are the two the product
 * offers.
 */
export function formatCalendarDate(value: string, dateFormat: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return value;
  const [, year = '', month = '', day = ''] = match;
  if (dateFormat === 'dd-MM-yyyy') return `${day}-${month}-${year}`;
  if (dateFormat === 'dd/MM/yyyy') return `${day}/${month}/${year}`;
  return value;
}

/** Minutes as `HH:mm`. Zero is empty: a weekly off did not work zero hours. */
export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  return `${pad(Math.floor(minutes / 60))}:${pad(Math.round(minutes % 60))}`;
}

export interface CellContext {
  readonly timezone: string;
  readonly dateFormat: string;
}

/**
 * One cell as text.
 *
 * Semicolons between flags rather than commas: the value is quoted either way,
 * but a reader scanning a `flags` cell in a spreadsheet should not have to
 * work out which commas are separators and which belong to the file format.
 */
export function formatCell(
  value: ReportCellValue,
  type: ReportColumnType,
  context: CellContext,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join('; ');

  if (typeof value === 'number') {
    return type === 'duration' ? formatDurationMinutes(value) : String(value);
  }

  const text = String(value);
  if (text.length === 0) return '';

  switch (type) {
    case 'date':
      return formatCalendarDate(text, context.dateFormat);
    case 'time':
      return formatInstant(text, context.timezone, false);
    case 'instant':
      return formatInstant(text, context.timezone, true);
    default:
      return text;
  }
}

// -------------------------------------------------------------------- writers

/**
 * RFC 4180 quoting, plus one addition that is not in the RFC.
 *
 * A cell beginning `=`, `+`, `-` or `@` is executed as a formula when the file
 * is opened in Excel or Sheets, and every value in this file comes from data
 * an employee typed -- a punch reason is free text. Prefixing with an
 * apostrophe is the standard neutralisation and is invisible in the
 * spreadsheet. Security §15 calls this out under data leakage in exports; it
 * is CSV injection, and it is the reason this function is not three lines.
 */
export function csvCell(value: string): string {
  const neutralised = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  if (!/[",\n\r]/u.test(neutralised)) return neutralised;
  return `"${neutralised.replaceAll('"', '""')}"`;
}

/** Excel needs CRLF and a BOM to read UTF-8 without mangling non-ASCII names. */
const LINE_END = '\r\n';
const UTF8_BOM = '﻿';

export class CsvReportWriter implements ReportWriter {
  readonly format = 'CSV' as const;
  readonly mime = 'text/csv; charset=utf-8';
  readonly extension = EXPORT_FORMAT_EXTENSIONS.CSV;
  readonly supportsSheetFormatting = false;

  private readonly lines: string[] = [];
  private columns: readonly ReportColumnSpec[] = [];
  private context: CellContext = { timezone: 'UTC', dateFormat: 'dd-MM-yyyy' };

  begin(meta: ReportSheetMeta, columns: readonly ReportColumnSpec[]): void {
    this.columns = columns;
    this.context = { timezone: meta.timezone, dateFormat: meta.dateFormat };

    // REQ-J-03's header block: who it belongs to, what it is, what was asked
    // for, and when it was produced.
    this.lines.push(csvCell(meta.orgName));
    this.lines.push(csvCell(meta.reportLabel));
    for (const caption of meta.captions) {
      this.lines.push(`${csvCell(caption.label)},${csvCell(caption.value)}`);
    }
    this.lines.push(
      `${csvCell('Generated')},${csvCell(
        `${formatCalendarDate(
          meta.generatedAt.toISOString().slice(0, 10),
          meta.dateFormat,
        )} ${formatInstant(meta.generatedAt.toISOString(), meta.timezone, true)} ${meta.timezone}`,
      )}`,
    );
    this.lines.push(`${csvCell('Rows')},${csvCell(String(meta.rowCount))}`);
    this.lines.push('');
    this.lines.push(columns.map((column) => csvCell(column.header)).join(','));
  }

  writeRow(cells: readonly ReportCellValue[]): void {
    const row: string[] = [];
    for (const [index, column] of this.columns.entries()) {
      row.push(csvCell(formatCell(cells[index] ?? null, column.type, this.context)));
    }
    this.lines.push(row.join(','));
  }

  finish(): Buffer {
    return Buffer.from(UTF8_BOM + this.lines.join(LINE_END) + LINE_END, 'utf8');
  }
}

/**
 * The one place a format becomes an implementation.
 *
 * `XLSX` is absent on purpose rather than falling through to CSV: a file named
 * `.xlsx` containing comma-separated text is the kind of quiet substitution
 * that is discovered by an accountant, not by a test. The request schema only
 * offers the formats that exist (`AVAILABLE_EXPORT_FORMATS`), so this throw is
 * unreachable from HTTP and is here for the day someone widens that list
 * without writing the writer.
 */
export function writerFor(format: ExportFormat): ReportWriter {
  if (format === 'CSV') return new CsvReportWriter();
  throw new Error(
    `No writer is implemented for export format "${format}". ` +
      'XLSX needs a spreadsheet library, which is a dependency decision (CLAUDE.md §6).',
  );
}
