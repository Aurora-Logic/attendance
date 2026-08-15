import { describe, expect, it } from 'vitest';

import {
  SubjectAccessCsvWriter,
  csvCell,
  formatCalendarDate,
  formatInstant,
  formatSubjectCell,
} from './subject-access-writer.js';

const META = {
  orgName: 'Vyuha Textiles',
  subjectLabel: 'Meera Nair (EMP0007)',
  requestedByLabel: 'hr@example.com',
  generatedAt: new Date('2026-08-15T04:30:00.000Z'),
  timezone: 'Asia/Kolkata',
  dateFormat: 'dd-MM-yyyy',
};

function lines(writer: SubjectAccessCsvWriter): string[] {
  return writer.finish().toString('utf8').replace(/^\uFEFF/u, '').split('\r\n');
}

describe('csvCell', () => {
  it('neutralises a cell a spreadsheet would execute as a formula', () => {
    // Security §15. A leave reason beginning with "=" is a formula in Excel,
    // and every free-text field in this file was typed by a person.
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+1 crore')).toBe("'+1 crore");
    expect(csvCell('-5 days')).toBe("'-5 days");
    expect(csvCell('@channel')).toBe("'@channel");
  });

  it('quotes and doubles the way RFC 4180 says', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('she said "no"')).toBe('"she said ""no"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('quotes a neutralised cell that also needs quoting', () => {
    expect(csvCell('=a,b')).toBe('"\'=a,b"');
  });
});

describe('formatCalendarDate', () => {
  it('renders the organisation format', () => {
    expect(formatCalendarDate('2026-08-15', 'dd-MM-yyyy')).toBe('15-08-2026');
    expect(formatCalendarDate('2026-08-15', 'dd/MM/yyyy')).toBe('15/08/2026');
  });

  it('leaves anything that is not a calendar date alone', () => {
    expect(formatCalendarDate('EMP0007', 'dd-MM-yyyy')).toBe('EMP0007');
  });
});

describe('formatInstant', () => {
  it('renders on the organisation wall clock, not UTC', () => {
    // +05:30 is exactly where offset arithmetic goes wrong, so the half hour
    // is the case worth pinning.
    expect(formatInstant(new Date('2026-08-15T04:30:00Z'), 'Asia/Kolkata', 'dd-MM-yyyy')).toBe(
      '15-08-2026 10:00:00',
    );
  });

  it('does not roll the date backwards west of Greenwich', () => {
    expect(formatInstant(new Date('2026-08-15T02:00:00Z'), 'America/New_York', 'dd-MM-yyyy')).toBe(
      '14-08-2026 22:00:00',
    );
  });

  it('renders midnight as 00, not 24', () => {
    expect(formatInstant(new Date('2026-08-14T18:30:00Z'), 'Asia/Kolkata', 'dd-MM-yyyy')).toBe(
      '15-08-2026 00:00:00',
    );
  });

  it('renders an unparseable date as empty rather than "Invalid Date"', () => {
    expect(formatInstant(new Date('nonsense'), 'Asia/Kolkata', 'dd-MM-yyyy')).toBe('');
  });
});

describe('formatSubjectCell', () => {
  it('renders each shape a driver hands back', () => {
    expect(formatSubjectCell(null, 'UTC', 'dd-MM-yyyy')).toBe('');
    expect(formatSubjectCell(undefined, 'UTC', 'dd-MM-yyyy')).toBe('');
    expect(formatSubjectCell(true, 'UTC', 'dd-MM-yyyy')).toBe('Yes');
    expect(formatSubjectCell(false, 'UTC', 'dd-MM-yyyy')).toBe('No');
    expect(formatSubjectCell(480, 'UTC', 'dd-MM-yyyy')).toBe('480');
    // `numeric` arrives as a string, and must not be reformatted into a date.
    expect(formatSubjectCell('1.50', 'UTC', 'dd-MM-yyyy')).toBe('1.50');
  });

  it('renders a Postgres timestamp string on the organisation wall clock', () => {
    // Drizzle keeps timestamps textual even through a raw `execute`, so an
    // instant arrives as a string and not as a `Date`. Caught in a produced
    // file: instants were printing as raw UTC beside converted calendar dates.
    expect(formatSubjectCell('2026-08-12 10:38:06.891372+00', 'Asia/Kolkata', 'dd-MM-yyyy')).toBe(
      '12-08-2026 16:08:06',
    );
    expect(formatSubjectCell('2026-08-12 12:12:04.87+00', 'Asia/Kolkata', 'dd-MM-yyyy')).toBe(
      '12-08-2026 17:42:04',
    );
    expect(formatSubjectCell('2026-08-12 13:41:35+00', 'Asia/Kolkata', 'dd-MM-yyyy')).toBe(
      '12-08-2026 19:11:35',
    );
  });

  it('reads the offset spellings Postgres uses that Date cannot parse alone', () => {
    expect(formatSubjectCell('2026-08-12 13:41:35+0530', 'UTC', 'dd-MM-yyyy')).toBe(
      '12-08-2026 08:11:35',
    );
    expect(formatSubjectCell('2026-08-12T13:41:35Z', 'UTC', 'dd-MM-yyyy')).toBe(
      '12-08-2026 13:41:35',
    );
    // No offset at all: a naive timestamp, which UTC is the only defensible
    // reading of.
    expect(formatSubjectCell('2026-08-12 13:41:35', 'UTC', 'dd-MM-yyyy')).toBe(
      '12-08-2026 13:41:35',
    );
  });

  it('leaves a string that only looks like a timestamp exactly as it came', () => {
    // Losing a value is worse than printing an awkward one.
    expect(formatSubjectCell('2026-13-45 99:99:99+00', 'UTC', 'dd-MM-yyyy')).toBe(
      '2026-13-45 99:99:99+00',
    );
    expect(formatSubjectCell('curl/8.7.1', 'UTC', 'dd-MM-yyyy')).toBe('curl/8.7.1');
  });

  it('renders a jsonb diff rather than losing it', () => {
    expect(formatSubjectCell({ status: 'ACTIVE' }, 'UTC', 'dd-MM-yyyy')).toBe('{"status":"ACTIVE"}');
  });

  it('joins an array with semicolons, not commas', () => {
    // A comma inside a cell is legal but makes a reader work out which commas
    // belong to the file format.
    expect(formatSubjectCell(['LATE', 'EARLY_EXIT'], 'UTC', 'dd-MM-yyyy')).toBe('LATE; EARLY_EXIT');
  });
});

describe('SubjectAccessCsvWriter', () => {
  it('states who the file is about and who asked for it', () => {
    const writer = new SubjectAccessCsvWriter();
    writer.begin(META);
    const out = lines(writer);

    expect(out[0]).toBe('Vyuha Textiles');
    expect(out[1]).toBe('Employee data export');
    expect(out[2]).toBe('Subject,Meera Nair (EMP0007)');
    expect(out[3]).toBe('Requested by,hr@example.com');
    expect(out[4]).toBe('Generated,15-08-2026 10:00:00 Asia/Kolkata');
  });

  it('says "no data held" for an empty section rather than printing nothing', () => {
    // An absent section and an empty one are different answers, and a reader of
    // a compliance file needs the second one stated rather than inferred.
    const writer = new SubjectAccessCsvWriter();
    writer.begin(META);
    writer.table('Punches', [{ key: 'a', header: 'A' }], []);

    expect(lines(writer)).toContain('No data held.');
    expect(writer.rowCount).toBe(0);
  });

  it('writes cells in the order the columns declare, not the order the row arrived', () => {
    const writer = new SubjectAccessCsvWriter();
    writer.begin(META);
    writer.table(
      'Devices',
      [
        { key: 'label', header: 'Label' },
        { key: 'seen', header: 'Last seen' },
      ],
      [['Pixel 7', new Date('2026-08-15T04:30:00Z')]],
    );

    const out = lines(writer);
    expect(out).toContain('Label,Last seen');
    expect(out).toContain('Pixel 7,15-08-2026 10:00:00');
  });

  it('pads a short row rather than shifting the columns left', () => {
    const writer = new SubjectAccessCsvWriter();
    writer.begin(META);
    writer.table(
      'Devices',
      [
        { key: 'a', header: 'A' },
        { key: 'b', header: 'B' },
        { key: 'c', header: 'C' },
      ],
      [['one']],
    );

    expect(lines(writer)).toContain('one,,');
  });

  it('counts every data row across sections', () => {
    const writer = new SubjectAccessCsvWriter();
    writer.begin(META);
    writer.facts('Identity', [
      ['Code', 'EMP0007'],
      ['Name', 'Meera'],
    ]);
    writer.table('Devices', [{ key: 'a', header: 'A' }], [['x'], ['y']]);

    expect(writer.rowCount).toBe(4);
  });

  it('carries the truncation note into the file', () => {
    const writer = new SubjectAccessCsvWriter();
    writer.begin(META);
    writer.table('Audit', [{ key: 'a', header: 'A' }], [['x']], 'Only the first 2 rows are shown.');

    expect(lines(writer)).toContain('Only the first 2 rows are shown.');
  });

  it('opens with a BOM and separates rows with CRLF, which is what Excel needs', () => {
    const writer = new SubjectAccessCsvWriter();
    writer.begin(META);
    const bytes = writer.finish();

    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes.toString('utf8')).toContain('\r\n');
  });
});
