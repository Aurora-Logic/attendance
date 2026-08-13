import type { HolidayImportRow } from './types';

/**
 * A pasted spreadsheet selection, turned into REQ-H-04's import rows.
 *
 * Pure, and separate from the sheet that renders it, so the parsing rules are
 * testable without a browser -- and because the awkward cases here are the
 * whole reason this file exists rather than a `split('\t')` inside a component.
 *
 * What real paste looks like, and what each case costs if it is wrong:
 *
 * - Excel puts tabs between cells; a CSV export puts commas; a European CSV
 *   export puts semicolons. Guessing one and silently reading the whole line
 *   as a date is the failure that produces "every row is in error" with no
 *   explanation.
 * - A name can contain a comma ("Christmas, observed"), so only the first
 *   separator splits the date off and only the last field is inspected for the
 *   restricted marker.
 * - Indian spreadsheets are usually formatted dd-MM-yyyy. Reading 03-04-2026
 *   as 3 April or as 4 March are both defensible, and getting it wrong moves a
 *   holiday by a month, so the day-first reading is chosen once, here, and
 *   stated on screen next to the box.
 */

export interface SheetProblem {
  /** 1-based, so it names the line the reader is looking at. */
  readonly line: number;
  readonly message: string;
}

export interface ParsedSheet {
  readonly rows: HolidayImportRow[];
  readonly problems: SheetProblem[];
}

const RESTRICTED_WORDS = new Set(['restricted', 'optional', 'rh', 'yes', 'true', 'y']);
const PUBLIC_WORDS = new Set(['public', 'national', 'no', 'false', 'n', '']);

/** Anything Excel or a CSV export puts between two cells. */
function splitCells(line: string): string[] {
  return line
    .split(/[\t,;]/u)
    .map((cell) => cell.trim())
    .filter((cell, index, all) => index < all.length - 1 || cell.length > 0);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD`, or null when the text is not a date this parser is sure about. */
export function normaliseDate(raw: string): string | null {
  const text = raw.trim();

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u.exec(text);
  if (iso) {
    return checked(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/u.exec(text);
  if (dayFirst) {
    return checked(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  }

  return null;
}

/**
 * Rejects 31 February rather than letting `Date` roll it into 3 March. A
 * holiday moved by two days is worse than a row the reader is asked to fix.
 */
function checked(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

export function parseSheetRows(text: string): ParsedSheet {
  const rows: HolidayImportRow[] = [];
  const problems: SheetProblem[] = [];

  text.split(/\r?\n/u).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.length === 0) return;

    const cells = splitCells(line);
    const dateCell = cells[0] ?? '';
    const date = normaliseDate(dateCell);

    // A header row is the commonest first line of a paste and is not an error
    // worth reporting; it is skipped the same way a blank line is.
    if (date === null && index === 0 && /date/iu.test(dateCell)) return;

    if (date === null) {
      problems.push({
        line: index + 1,
        message: `"${dateCell}" is not a date. Write it as 2026-01-26 or 26-01-2026.`,
      });
      return;
    }

    const rest = cells.slice(1);
    const last = (rest[rest.length - 1] ?? '').toLowerCase();
    const restricted = RESTRICTED_WORDS.has(last);
    // Only a recognised word is treated as the flag column. An unrecognised
    // trailing cell stays part of the name, because dropping it would silently
    // lose half of "Holi, second day".
    const nameCells = restricted || PUBLIC_WORDS.has(last) ? rest.slice(0, -1) : rest;
    const name = nameCells.join(' ').trim();

    if (name.length === 0) {
      problems.push({ line: index + 1, message: 'The row has a date but no holiday name.' });
      return;
    }

    rows.push({ date, name, restricted });
  });

  return { rows, problems };
}
