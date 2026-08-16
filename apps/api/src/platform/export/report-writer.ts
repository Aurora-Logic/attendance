import {
  EXPORT_FORMAT_EXTENSIONS,
  type ExportFormat,
  type ReportCellValue,
  type ReportColumnSpec,
} from '@vyuha/shared';

import {
  formatCalendarDate,
  formatCell,
  formatInstant,
  type CellContext,
  type ReportSheetMeta,
  type ReportWriter,
} from './report-cell.js';
import { XlsxReportWriter } from './xlsx-writer.js';

/*
 * Re-exported so the one import path for "how a report becomes a file" still
 * answers for the cell helpers it used to own. `report-cell.ts` is where they
 * live now; this keeps every existing caller and test pointing here.
 */
export {
  formatCalendarDate,
  formatCell,
  formatDurationMinutes,
  formatInstant,
  type CellContext,
  type ReportSheetMeta,
  type ReportWriter,
} from './report-cell.js';

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

  finish(): Promise<Buffer> {
    return Promise.resolve(Buffer.from(UTF8_BOM + this.lines.join(LINE_END) + LINE_END, 'utf8'));
  }
}

/**
 * The one place a format becomes an implementation.
 *
 * Both formats now exist. The throw stays for the day someone widens
 * `EXPORT_FORMATS` without writing the writer -- falling through to CSV would
 * produce a file named `.xlsx` containing comma-separated text, which is the
 * kind of quiet substitution discovered by an accountant rather than by a test.
 */
export function writerFor(format: ExportFormat): ReportWriter {
  if (format === 'CSV') return new CsvReportWriter();
  if (format === 'XLSX') return new XlsxReportWriter();
  throw new Error(`No writer is implemented for export format "${String(format)}".`);
}
