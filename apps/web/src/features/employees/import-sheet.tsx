import { useMemo, useState } from 'react';
import {
  CheckCircleIcon,
  ClipboardTextIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';

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
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useIsMobile } from '@/hooks/use-mobile';
import { ShortcutLayer } from '@/lib/keyboard/registry';
import { MAX_EMPLOYEE_IMPORT_ROWS } from '@vyuha/shared';

import {
  TEMPLATE_EXAMPLE,
  annotatedErrorSheet,
  parseEmployeeSheet,
  type ParsedEmployeeSheet,
} from './import-rows';
import { useImportEmployees, type EmployeeImportRowResult } from './use-employee-import';

/**
 * REQ-A-06: "Bulk import employees from Excel: download template → upload →
 * server-side validation → preview of valid rows and per-row errors → commit.
 * Partial commit allowed; errors downloadable as an annotated sheet."
 *
 * The employees empty state has promised this ever since it was written; the
 * endpoints have existed and been tested; there was no screen. This follows the
 * holiday import (`features/holidays/import-sheet.tsx`) rather than inventing a
 * second shape, including the reason it takes a paste instead of a file: the
 * clipboard's TSV is the same columns a saved .xlsx holds, and reading the
 * binary workbook would mean adding a library CLAUDE.md §6 does not allow
 * without asking. The server contract is rows either way.
 *
 * One thing is deliberately unlike the holiday import. That one refuses a sheet
 * containing any error, whole. This one does not, because the endpoint's own
 * comment says why: "refusing a hundred good rows over one typo is how somebody
 * ends up editing records by hand instead." So the Import button stays open
 * with errors present, and the button and the summary both say exactly how many
 * rows will be created and how many will be left behind.
 */

const ACTION_TONE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  CREATE: 'default',
  ERROR: 'destructive',
};

const PREVIEW_COLUMNS: RecordColumn<EmployeeImportRowResult>[] = [
  {
    key: 'rowNumber',
    header: 'Row',
    cell: (row) => String(row.rowNumber),
    numeric: true,
    secondary: true,
  },
  {
    key: 'employeeCode',
    header: 'Code',
    cell: (row) => <span className="font-medium tabular-nums">{row.employeeCode}</span>,
  },
  {
    key: 'result',
    header: 'Result',
    cell: (row) => (
      <div className="flex flex-col items-start gap-1">
        <Badge variant={ACTION_TONE[row.action] ?? 'secondary'}>{row.action.toLowerCase()}</Badge>
        {row.errors.length > 0 ? (
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
            {row.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
      </div>
    ),
  },
];

interface ImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmployeeImportSheet({ open, onOpenChange }: ImportSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-2xl max-md:max-h-[92vh]"
      >
        {open ? (
          <ImportSheetBody
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Hands a file to the browser without a dependency and without a route.
 *
 * An object URL rather than a `data:` URL: a five-hundred-row corrections file
 * is comfortably past the length some browsers will follow in an href, and the
 * failure is a download that silently does nothing.
 */
function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ImportSheetBody({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [committed, setCommitted] = useState(false);
  const importer = useImportEmployees();

  const sheet: ParsedEmployeeSheet = useMemo(() => parseEmployeeSheet(text), [text]);
  const report = importer.data;

  // A preview goes stale the moment the paste changes, and a stale preview
  // beside a live Import button is how somebody commits something they never
  // read.
  const previewIsCurrent =
    report !== undefined && importer.variables?.rows.length === sheet.rows.length;

  const overCap = sheet.rows.length > MAX_EMPLOYEE_IMPORT_ROWS;
  const creatable = previewIsCurrent && report ? report.counts.CREATE : 0;
  const failing = previewIsCurrent && report ? report.counts.ERROR : 0;

  function run(mode: 'validate' | 'commit') {
    if (sheet.rows.length === 0 || overCap) return;
    importer.mutate(
      { rows: sheet.rows, mode },
      {
        onSuccess: (result) => {
          if (mode !== 'commit') return;
          setCommitted(true);
          toast.add({
            type: result.counts.ERROR > 0 ? 'warning' : 'success',
            title: `${String(result.createdCount)} employee${result.createdCount === 1 ? '' : 's'} created`,
            description:
              result.counts.ERROR > 0
                ? `${String(result.counts.ERROR)} row${result.counts.ERROR === 1 ? '' : 's'} were left behind. Download the corrections and paste them back.`
                : 'Every row in the file was created.',
          });
        },
      },
    );
  }

  const copy = actionErrorCopy(importer.error, 'The import');

  return (
    <ShortcutLayer id="modal:employee-import">
      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>Import employees</SheetTitle>
        <SheetDescription>
          Copy the rows out of your spreadsheet — including the header line — and paste them here.
          Nothing is created until you have seen what the file would do.
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
              <AlertDescription>
                {copy.description}{' '}
                {importer.variables?.mode === 'commit'
                  ? 'Some rows may already have been created; preview again to see which.'
                  : 'Nothing was written.'}
              </AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="employee-import-rows">Pasted rows</FieldLabel>
            <Textarea
              id="employee-import-rows"
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={TEMPLATE_EXAMPLE}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setCommitted(false);
              }}
            />
            <FieldDescription>
              The first line names the columns, so they may be in any order and extra columns are
              ignored. Employee code, first name and date of joining are required; departments,
              designations, locations and the reporting manager are matched by the names already in
              the system. Dates may be written 2026-04-01 or 01-04-2026.
            </FieldDescription>
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                downloadText('vyuha-employee-import-template.csv', TEMPLATE_EXAMPLE.replaceAll('\t', ','));
              }}
            >
              <DownloadSimpleIcon data-icon="inline-start" />
              Download the template
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setText(TEMPLATE_EXAMPLE);
                setCommitted(false);
              }}
            >
              <ClipboardTextIcon data-icon="inline-start" />
              Paste an example row
            </Button>
          </div>

          {sheet.missingColumns.length > 0 ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>
                The header line is missing {sheet.missingColumns.join(' and ')}
              </AlertTitle>
              <AlertDescription>
                Nothing can be read without it. Add the column to the first line, or download the
                template and copy your data into it.
              </AlertDescription>
            </Alert>
          ) : null}

          {sheet.ignoredColumns.length > 0 ? (
            <Alert>
              <CheckCircleIcon />
              <AlertTitle>
                {sheet.ignoredColumns.length} column
                {sheet.ignoredColumns.length === 1 ? '' : 's'} will be ignored
              </AlertTitle>
              <AlertDescription>
                {sheet.ignoredColumns.join(', ')}. This product does not hold them, so they are left
                out rather than loaded into a field they do not belong in.
              </AlertDescription>
            </Alert>
          ) : null}

          {sheet.problems.length > 0 ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>
                {String(sheet.problems.length)} line
                {sheet.problems.length === 1 ? '' : 's'} could not be read
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {sheet.problems.slice(0, 6).map((problem) => (
                    <li key={problem.line}>
                      Line {problem.line}: {problem.message}
                    </li>
                  ))}
                </ul>
                {sheet.problems.length > 6
                  ? `and ${String(sheet.problems.length - 6)} more.`
                  : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {overCap ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>
                {String(sheet.rows.length)} rows is more than one import can carry
              </AlertTitle>
              <AlertDescription>
                The limit is {String(MAX_EMPLOYEE_IMPORT_ROWS)} rows at a time, so one request
                cannot hold a connection open resolving ten thousand names. Split the file and
                import it in parts.
              </AlertDescription>
            </Alert>
          ) : null}

          {previewIsCurrent && report ? (
            <div className="flex flex-col gap-3">
              <Alert variant={failing > 0 ? 'destructive' : 'default'}>
                {failing > 0 ? <WarningCircleIcon /> : <CheckCircleIcon />}
                <AlertTitle>
                  {report.committed ? 'Imported' : 'Preview'}: {String(creatable)} to create,{' '}
                  {String(failing)} in error
                </AlertTitle>
                <AlertDescription>
                  {report.committed
                    ? `${String(report.createdCount)} employee${report.createdCount === 1 ? '' : 's'} created.${failing > 0 ? ' The rows in error were left behind and can be corrected and pasted back.' : ''}`
                    : failing > 0
                      ? 'The good rows can still be imported — the rows in error are simply left behind. Fix them and import again, or download the corrections below.'
                      : 'Nothing has been written yet.'}
                </AlertDescription>
              </Alert>

              {failing > 0 ? (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      downloadText(
                        'vyuha-employee-import-corrections.csv',
                        annotatedErrorSheet(sheet.rows, report.rows),
                      );
                    }}
                  >
                    <DownloadSimpleIcon data-icon="inline-start" />
                    Download the {String(failing)} row{failing === 1 ? '' : 's'} to fix
                  </Button>
                </div>
              ) : null}

              <RecordTable
                columns={PREVIEW_COLUMNS}
                rows={[...report.rows]}
                rowKey={(row) => `${String(row.rowNumber)}-${row.employeeCode}`}
                mobilePrimary={(row) => row.employeeCode}
                mobileStatus={(row) => (
                  <Badge variant={ACTION_TONE[row.action] ?? 'secondary'}>
                    {row.action.toLowerCase()}
                  </Badge>
                )}
                mobileSupporting={(row) =>
                  row.errors.length > 0 ? row.errors.join('; ') : `Row ${String(row.rowNumber)}`
                }
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
          disabled={sheet.rows.length === 0 || overCap || importer.isPending}
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
          // Import stays shut until a current preview exists and it would
          // create something: the reader has to have seen what they are about
          // to do, and a file of nothing but errors has nothing to import.
          disabled={!previewIsCurrent || creatable === 0 || importer.isPending || committed}
          onClick={() => {
            run('commit');
          }}
        >
          {importer.isPending && importer.variables?.mode === 'commit' ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadSimpleIcon data-icon="inline-start" />
          )}
          Import {creatable > 0 ? String(creatable) : ''}
        </Button>
      </SheetFooter>
    </ShortcutLayer>
  );
}
