import { useMemo, useState } from 'react';
import { CheckCircleIcon, UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { Form } from '@/components/shared/form';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatDate } from '@/lib/format';
import { ShortcutLayer } from '@/lib/keyboard/registry';

import { parseSheetRows, type ParsedSheet } from './sheet-rows';
import type { HolidayImportRowResult } from './types';
import { useImportHolidays } from './use-holidays';

/**
 * REQ-H-04: "Bulk import a year's holidays from Excel."
 *
 * What arrives here is the selected range from the spreadsheet, pasted. That
 * is the clipboard's TSV, which is the same three columns a saved .xlsx holds,
 * and it needs no parser dependency and no upload round trip. Reading the
 * binary workbook would mean adding a library, which CLAUDE.md §6 does not
 * allow without asking; the server contract is rows either way, so wiring a
 * file reader in later changes this component and nothing else.
 *
 * Nothing is written until the reader has seen the plan. `/validate` returns
 * exactly what `/commit` will do -- same planner, same rows -- so the preview
 * below is not an estimate of the import, it is the import.
 */

const ACTION_TONE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  CREATE: 'default',
  UPDATE: 'default',
  UNCHANGED: 'secondary',
  SKIPPED: 'outline',
  ERROR: 'destructive',
};

const PREVIEW_COLUMNS: RecordColumn<HolidayImportRowResult>[] = [
  {
    key: 'row',
    header: 'Row',
    cell: (row) => String(row.row),
    numeric: true,
    secondary: true,
  },
  {
    key: 'date',
    header: 'Date',
    cell: (row) => formatDate(row.date),
    className: 'tabular-nums',
  },
  { key: 'name', header: 'Holiday', cell: (row) => row.name },
  {
    key: 'action',
    header: 'Result',
    cell: (row) => (
      <div className="flex flex-col items-start gap-1">
        <Badge variant={ACTION_TONE[row.action] ?? 'secondary'}>{row.action.toLowerCase()}</Badge>
        {row.message ? (
          <span className="text-muted-foreground text-xs">{row.message}</span>
        ) : null}
      </div>
    ),
  },
];

const PLACEHOLDER = ['2026-01-26\tRepublic Day', '2026-03-04\tHoli\trestricted'].join('\n');

interface ImportSheetProps {
  calendarId: string | null;
  calendarName: string;
  year: number;
  onOpenChange: (open: boolean) => void;
}

export function ImportSheet({ calendarId, calendarName, year, onOpenChange }: ImportSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={calendarId !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-2xl max-md:max-h-[92vh]"
      >
        {calendarId !== null ? (
          <ImportSheetBody
            key={calendarId}
            calendarId={calendarId}
            calendarName={calendarName}
            year={year}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ImportSheetBody({
  calendarId,
  calendarName,
  year,
  onClose,
}: {
  calendarId: string;
  calendarName: string;
  year: number;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const importer = useImportHolidays();

  const sheet: ParsedSheet = useMemo(() => parseSheetRows(text), [text]);
  const report = importer.data;
  // A preview goes stale the moment the paste or the overwrite switch changes,
  // and a stale preview beside a live Import button is how somebody commits
  // something they never read.
  const previewIsCurrent =
    report !== undefined &&
    importer.variables?.rows.length === sheet.rows.length &&
    importer.variables.overwriteExisting === overwriteExisting;

  function run(mode: 'validate' | 'commit') {
    if (sheet.rows.length === 0) return;
    importer.mutate(
      { calendarId, rows: sheet.rows, overwriteExisting, mode },
      {
        onSuccess: (result) => {
          if (mode !== 'commit') return;
          setCommitted(true);
          toast.add({
            type: 'success',
            title: 'Holidays imported',
            description:
              `${String(result.counts.CREATE)} added, ${String(result.counts.UPDATE)} updated. ` +
              `${String(result.recompute?.recomputed ?? 0)} attendance days recomputed.`,
          });
        },
      },
    );
  }

  const copy = actionErrorCopy(importer.error, 'The import');
  const blocked = previewIsCurrent && report !== undefined && report.counts.ERROR > 0;

  return (
    <ShortcutLayer id={`modal:holiday-import-${calendarId}`}>
      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>Import holidays</SheetTitle>
        <SheetDescription>
          Into {calendarName}, {String(year)}. Copy the date, name and an optional
          &ldquo;restricted&rdquo; column out of the spreadsheet and paste them here.
        </SheetDescription>
      </SheetHeader>

      <Form
        onSubmit={() => {
          run('validate');
        }}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <FieldGroup>
          {importer.isError ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>{copy.description} Nothing was written.</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="import-rows">Pasted rows</FieldLabel>
            <Textarea
              id="import-rows"
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={PLACEHOLDER}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setCommitted(false);
              }}
            />
            <FieldDescription>
              One holiday per line: date, then name, then optionally the word
              &ldquo;restricted&rdquo;. Tabs, commas or semicolons all separate the columns. Dates
              may be written 2026-01-26 or 26-01-2026.
            </FieldDescription>
          </Field>

          {sheet.problems.length > 0 ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>
                {String(sheet.problems.length)} line
                {sheet.problems.length === 1 ? '' : 's'} could not be read
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {sheet.problems.slice(0, 5).map((problem) => (
                    <li key={problem.line}>
                      Line {problem.line}: {problem.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <Field orientation="horizontal">
            <FieldLabel htmlFor="import-overwrite">Overwrite dates already in the list</FieldLabel>
            <Switch
              id="import-overwrite"
              checked={overwriteExisting}
              onCheckedChange={(next: boolean) => {
                setOverwriteExisting(next);
                setCommitted(false);
              }}
            />
          </Field>
          <FieldDescription>
            Off by default, so re-running the same sheet changes nothing and a name somebody
            corrected by hand is not quietly replaced.
          </FieldDescription>

          {previewIsCurrent && report ? (
            <div className="flex flex-col gap-3">
              <Alert variant={report.counts.ERROR > 0 ? 'destructive' : 'default'}>
                {report.counts.ERROR > 0 ? <WarningCircleIcon /> : <CheckCircleIcon />}
                <AlertTitle>
                  {report.dryRun ? 'Preview' : 'Imported'}: {String(report.counts.CREATE)} to add,{' '}
                  {String(report.counts.UPDATE)} to update, {String(report.counts.UNCHANGED)}{' '}
                  unchanged, {String(report.counts.SKIPPED)} skipped,{' '}
                  {String(report.counts.ERROR)} in error
                </AlertTitle>
                <AlertDescription>
                  {report.counts.ERROR > 0
                    ? 'Fix the rows below and preview again. A sheet with an error is refused whole, so nothing is half-imported.'
                    : report.dryRun
                      ? 'Nothing has been written yet.'
                      : `${String(report.recompute?.recomputed ?? 0)} attendance days were recomputed.`}
                </AlertDescription>
              </Alert>

              <RecordTable
                columns={PREVIEW_COLUMNS}
                rows={[...report.rows]}
                rowKey={(row) => `${String(row.row)}-${row.date}`}
                mobilePrimary={(row) => row.name}
                mobileStatus={(row) => (
                  <Badge variant={ACTION_TONE[row.action] ?? 'secondary'}>
                    {row.action.toLowerCase()}
                  </Badge>
                )}
                mobileSupporting={(row) => `${formatDate(row.date)}${row.message ? ` · ${row.message}` : ''}`}
              />
            </div>
          ) : null}
        </FieldGroup>
      </Form>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          {committed ? 'Close' : 'Cancel'}
        </Button>
        <Button
          variant="outline"
          className="flex-1 sm:flex-none"
          disabled={sheet.rows.length === 0 || importer.isPending}
          onClick={() => {
            run('validate');
          }}
        >
          {importer.isPending && importer.variables?.mode === 'validate' ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          Preview {sheet.rows.length > 0 ? `(${String(sheet.rows.length)})` : ''}
        </Button>
        <Button
          className="flex-1 sm:flex-none"
          // Import stays shut until a current preview exists and it is clean:
          // the reader has to have seen what they are about to do.
          disabled={!previewIsCurrent || blocked || importer.isPending || committed}
          onClick={() => {
            run('commit');
          }}
        >
          {importer.isPending && importer.variables?.mode === 'commit' ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadSimpleIcon data-icon="inline-start" />
          )}
          Import
        </Button>
      </SheetFooter>
    </ShortcutLayer>
  );
}
