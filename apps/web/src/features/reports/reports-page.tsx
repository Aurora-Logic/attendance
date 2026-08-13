import { useMemo, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChartBarIcon,
  DownloadSimpleIcon,
  ImageIcon,
  SwapIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { endOfMonth, startOfMonth, subDays } from 'date-fns';
import { useSearchParams } from 'react-router';
import type { DateRange } from 'react-day-picker';

import { PageHeader } from '@/components/shared/page-header';
import { RecordPagination } from '@/components/shared/record-pagination';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { usePermission } from '@/lib/session/permissions';
import { useShortcut } from '@/lib/keyboard/registry';
import { EMPTY_VALUE, humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  DEFAULT_PAGE_SIZE,
  PERMISSIONS,
  REPORT_KEYS,
  attendanceRegisterCell,
  defaultVisibleColumns,
  describeFilters,
  isReportKey,
  punchAuditCell,
  resolveColumns,
  type ReportCellValue,
  type ReportColumnSpec,
  type ReportDefinition,
  type ReportFilters,
  type ReportKey,
  type SavedView,
} from '@vyuha/shared';

import {
  useAttendanceRegister,
  useDeleteView,
  useDepartmentOptions,
  useLocationOptions,
  usePunchAudit,
  useReportCatalogue,
  useRequestExport,
  useSavedViews,
  useSaveView,
  type ReportRowsParams,
} from './api';
import { ColumnChooser } from './column-chooser';
import { ReportFilterBar, type ReportFilterState } from './filter-bar';
import { isNumericColumn, renderCell } from './format';
import { PunchPhotoSheet } from './punch-photo-sheet';
import { SavedViews } from './saved-views';
import type { AttendanceRegisterRow, PunchAuditRow } from './types';

/**
 * The one report shell (REQ-J-01): filter bar, column chooser, sort,
 * pagination, saved views, and an export button.
 *
 * Everything on this screen is driven by the report definition the server
 * sends -- the columns, which filters apply, what may be sorted. Adding a leave
 * report is a definition and a row source on the API, and nothing here.
 *
 * All state lives in the query string, for the reason the muster gives: a
 * filtered report has to be a link somebody can paste into a message, and has
 * to survive a reload. It is also what makes a saved view a set of query
 * parameters rather than a second source of truth.
 */

function readPositiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/** `YYYY-MM-DD` for an endpoint, from a Date. Never the ISO instant (NFR-05). */
function toDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

function fromDateParam(raw: string | null): Date | undefined {
  if (raw === null) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(raw);
  if (match === null) return undefined;
  // Local midnight. `new Date('2026-08-12')` reads the string as UTC and
  // yields the previous day west of Greenwich.
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** This month, which is what a reader opening a report almost always wants. */
function defaultPeriod(): DateRange {
  const now = new Date();
  return { from: startOfMonth(now), to: endOfMonth(now) };
}

function TableSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the report" className="border">
      {Array.from({ length: 10 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-20 shrink-0" />
          <Skeleton className="h-3 w-24 shrink-0" />
          <Skeleton className="hidden h-3 w-32 shrink-0 sm:block" />
          <Skeleton className="hidden h-3 w-16 shrink-0 xl:block" />
          <Skeleton className="ml-auto h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function ReportSwitcher({
  reports,
  current,
  open,
  onOpenChange,
  onSelect,
}: {
  reports: readonly ReportDefinition[];
  current: ReportKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: ReportKey) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Switch report</DialogTitle>
        <DialogDescription className="sr-only">
          Pick the report to show. PRD section 6.4 gives this Ctrl+G.
        </DialogDescription>
        <Command>
          <CommandInput placeholder="Switch to a report" />
          <CommandList>
            <CommandEmpty>No report matches.</CommandEmpty>
            <CommandGroup heading="Reports">
              {reports.map((report) => (
                <CommandItem
                  key={report.key}
                  value={`${report.label} ${report.description}`}
                  onSelect={() => {
                    onSelect(report.key);
                    onOpenChange(false);
                  }}
                >
                  <ChartBarIcon />
                  <span className={cn(report.key === current && 'font-medium')}>
                    {report.label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [selectedPunch, setSelectedPunch] = useState<PunchAuditRow | null>(null);

  const canExport = usePermission(PERMISSIONS.REPORT_EXPORT);
  const catalogue = useReportCatalogue();
  const departments = useDepartmentOptions();
  const locations = useLocationOptions();

  const reportParam = searchParams.get('report');
  const reportKey: ReportKey = isReportKey(reportParam ?? '')
    ? (reportParam as ReportKey)
    : REPORT_KEYS[0];

  const definition =
    catalogue.data?.find((report) => report.key === reportKey) ?? catalogue.data?.[0];

  // --------------------------------------------------------------- state

  const period: DateRange = {
    from: fromDateParam(searchParams.get('from')) ?? defaultPeriod().from,
    to: fromDateParam(searchParams.get('to')) ?? defaultPeriod().to,
  };

  const filters: ReportFilterState = {
    period,
    departmentId: searchParams.get('departmentId'),
    locationId: searchParams.get('locationId'),
    employeeId: searchParams.get('employeeId'),
    status: searchParams.get('status'),
    flags: searchParams.get('flags'),
    punchType: searchParams.get('punchType'),
  };

  const sort = searchParams.get('sort') ?? definition?.defaultSort ?? '';
  const page = readPositiveInt(searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = DEFAULT_PAGE_SIZE;

  const visibleColumns = useMemo(() => {
    const raw = searchParams.get('columns');
    const chosen = raw === null ? undefined : raw.split(',').filter(Boolean);
    return resolveColumns(reportKey, chosen).map((column) => column.key);
  }, [searchParams, reportKey]);

  const columns: ReportColumnSpec[] = useMemo(() => {
    if (definition === undefined) return [];
    const chosen = new Set(visibleColumns);
    return definition.columns.filter((column) => chosen.has(column.key));
  }, [definition, visibleColumns]);

  function patchParams(apply: (params: URLSearchParams) => void, keepPage = false) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      apply(next);
      // Narrowing invalidates the page number: page 4 of three pages is an
      // empty screen that looks like no matches.
      if (!keepPage) next.delete('page');
      return next;
    });
  }

  function setFilters(patch: Partial<ReportFilterState>) {
    patchParams((params) => {
      if (patch.period !== undefined) {
        if (patch.period.from) params.set('from', toDateParam(patch.period.from));
        else params.delete('from');
        if (patch.period.to) params.set('to', toDateParam(patch.period.to));
        else params.delete('to');
      }
      for (const key of ['departmentId', 'locationId', 'employeeId', 'status', 'flags', 'punchType'] as const) {
        if (!(key in patch)) continue;
        const value = patch[key];
        if (value === null || value === undefined) params.delete(key);
        else params.set(key, value);
      }
    });
  }

  function clearFilters() {
    patchParams((params) => {
      for (const key of ['from', 'to', 'departmentId', 'locationId', 'employeeId', 'status', 'flags', 'punchType'] as const) {
        params.delete(key);
      }
    });
  }

  function switchReport(next: ReportKey) {
    // A fresh set of parameters, not a patch: the previous report's columns
    // and sort do not exist on this one, and carrying them over produces a
    // table whose chooser and header disagree.
    setSearchParams(() => {
      const params = new URLSearchParams();
      params.set('report', next);
      const from = searchParams.get('from');
      const to = searchParams.get('to');
      if (from !== null) params.set('from', from);
      if (to !== null) params.set('to', to);
      return params;
    });
  }

  function toggleSort(field: string) {
    const descending = sort === field;
    patchParams((params) => {
      params.set('sort', descending ? `-${field}` : field);
    });
  }

  // ----------------------------------------------------------- shortcuts

  // PRD §6.4: F12 configures the current screen.
  useShortcut({
    id: 'reports.configure',
    keys: 'f12',
    label: 'Choose columns',
    scope: 'screen',
    run: () => {
      setChooserOpen(true);
    },
  });

  // PRD §6.4: Alt+F2 changes the period.
  useShortcut({
    id: 'reports.period',
    keys: 'alt+f2',
    label: 'Change period',
    scope: 'screen',
    run: () => {
      setPeriodOpen(true);
    },
  });

  // PRD §6.4: Ctrl+G switches to another report.
  useShortcut({
    id: 'reports.switch',
    keys: 'ctrl+g',
    label: 'Switch report',
    scope: 'screen',
    run: () => {
      setSwitcherOpen(true);
    },
  });

  // ------------------------------------------------------------- queries

  const rowParams: ReportRowsParams = {
    page,
    pageSize,
    sort,
    ...(period.from ? { from: toDateParam(period.from) } : {}),
    ...(period.to ? { to: toDateParam(period.to) } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
    ...(filters.status ? { status: filters.status as ReportFilters['status'] } : {}),
    ...(filters.flags ? { flags: filters.flags } : {}),
    ...(filters.punchType ? { punchType: filters.punchType as ReportFilters['punchType'] } : {}),
  };

  const register = useAttendanceRegister(rowParams, reportKey === 'attendance-register');
  const audit = usePunchAudit(rowParams, reportKey === 'punch-audit');
  const active = reportKey === 'attendance-register' ? register : audit;

  const savedViews = useSavedViews(reportKey);
  const saveView = useSaveView();
  const deleteView = useDeleteView(reportKey);
  const requestExport = useRequestExport();

  const total = active.data?.meta.total ?? 0;

  // ------------------------------------------------------------- actions

  const exportFilters: ReportFilters = {
    ...(period.from ? { from: toDateParam(period.from) } : {}),
    ...(period.to ? { to: toDateParam(period.to) } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
    ...(filters.status ? { status: filters.status as ReportFilters['status'] } : {}),
    ...(filters.flags ? { flags: filters.flags } : {}),
    ...(filters.punchType ? { punchType: filters.punchType as ReportFilters['punchType'] } : {}),
  };

  function startExport() {
    if (!canExport) return;
    if (!period.from || !period.to) {
      toast.add({
        type: 'error',
        title: 'Pick a period first',
        description: 'An export always states the range it covers.',
      });
      return;
    }
    requestExport.mutate(
      {
        reportKey,
        filters: { ...exportFilters, from: toDateParam(period.from), to: toDateParam(period.to) },
        columns: visibleColumns,
        sort,
        format: 'CSV',
      },
      {
        onSuccess: (job) => {
          toast.add({
            type: 'success',
            title: 'Export started',
            description: `${job.filename} will appear in Downloads when it is ready.`,
          });
        },
        onError: (error: Error) => {
          toast.add({ type: 'error', title: 'Export refused', description: error.message });
        },
      },
    );
  }

  // PRD §6.4: Alt+E exports.
  useShortcut({
    id: 'reports.export',
    keys: 'alt+e',
    label: 'Export',
    scope: 'screen',
    when: () => canExport,
    run: startExport,
  });

  function applyView(view: SavedView) {
    setSearchParams(() => {
      const params = new URLSearchParams();
      params.set('report', reportKey);
      for (const [key, value] of Object.entries(view.config.filters)) {
        if (value !== undefined && value !== null) params.set(key, String(value));
      }
      if (view.config.columns.length > 0) params.set('columns', view.config.columns.join(','));
      if (view.config.sort !== undefined) params.set('sort', view.config.sort);
      return params;
    });
    toast.add({ type: 'info', title: 'View applied', description: view.name });
  }

  // ---------------------------------------------------------- rendering

  const cellFor = (row: AttendanceRegisterRow | PunchAuditRow, key: string): ReportCellValue =>
    reportKey === 'attendance-register'
      ? attendanceRegisterCell(row as AttendanceRegisterRow, key)
      : punchAuditCell(row as PunchAuditRow, key);

  const tableColumns: RecordColumn<AttendanceRegisterRow | PunchAuditRow>[] = columns.map(
    (column) => ({
      key: column.key,
      header: column.header,
      numeric: isNumericColumn(column.type),
      secondary: column.secondary === true,
      cell: (row) => renderCell(cellFor(row, column.key), column.type),
    }),
  );

  // The photo is chrome, not a column: it has no cell in the exported file and
  // must never be one, so it is added to the table rather than to the report's
  // column set (REQ-J-02).
  if (reportKey === 'punch-audit') {
    tableColumns.unshift({
      key: 'photo',
      header: 'Photo',
      className: 'w-16',
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label="View the punch photo"
          className="pointer-coarse:size-11"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedPunch(row as PunchAuditRow);
          }}
        >
          <ImageIcon />
        </Button>
      ),
    });
  }

  /**
   * PRD §6.5's line two: "two supporting fields".
   *
   * Chosen rather than "the next two columns", because line one already
   * carries the employee's name and the status pill -- repeating either is a
   * row that says one thing twice and the useful field not at all.
   */
  const supporting = columns.filter(
    (column) => !['employeeName', 'status', 'type'].includes(column.key),
  );

  const rows: (AttendanceRegisterRow | PunchAuditRow)[] =
    reportKey === 'attendance-register' ? (register.data?.data ?? []) : (audit.data?.data ?? []);

  const isFiltered =
    filters.departmentId !== null ||
    filters.locationId !== null ||
    filters.employeeId !== null ||
    filters.status !== null ||
    filters.flags !== null ||
    filters.punchType !== null;

  const captions = describeFilters(exportFilters);

  return (
    <>
      <PageHeader
        description={definition?.description ?? 'Every report shares one shell.'}
        action={
          <>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setSwitcherOpen(true);
              }}
            >
              <SwapIcon data-icon="inline-start" />
              <span className="hidden sm:inline">{definition?.label ?? 'Report'}</span>
              <ShortcutHint keys="ctrl+g" className="hidden md:inline-flex" />
            </Button>

            <Button
              className="gap-2"
              disabled={!canExport || requestExport.isPending}
              onClick={startExport}
            >
              <DownloadSimpleIcon data-icon="inline-start" />
              Export
              <ShortcutHint keys="alt+e" className="hidden md:inline-flex" />
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {!canExport ? (
          <p className="text-muted-foreground text-xs">
            Export is disabled: it needs the report export permission.
          </p>
        ) : null}

        {/* Toolbar (PRD §6.2). Wraps at 360px rather than scrolling sideways. */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <ReportFilterBar
            available={definition?.filters ?? []}
            value={filters}
            onChange={setFilters}
            departments={departments.data ?? []}
            locations={locations.data ?? []}
            periodOpen={periodOpen}
            onPeriodOpenChange={setPeriodOpen}
            onClear={clearFilters}
            isFiltered={isFiltered}
          />

          <div className="flex flex-wrap items-center gap-2">
            <SavedViews
              views={savedViews.data ?? []}
              isLoading={savedViews.isPending}
              currentConfig={{ filters: exportFilters, columns: visibleColumns, sort }}
              isSaving={saveView.isPending}
              onApply={applyView}
              onSave={async (input) => {
                await saveView.mutateAsync({ reportKey, ...input });
              }}
              onDelete={async (view) => {
                await deleteView.mutateAsync(view.id);
              }}
            />

            <ColumnChooser
              columns={definition?.columns ?? []}
              visible={visibleColumns}
              open={chooserOpen}
              onOpenChange={setChooserOpen}
              onVisibleChange={(next) => {
                patchParams((params) => {
                  params.set('columns', next.join(','));
                }, true);
              }}
              onReset={() => {
                patchParams((params) => {
                  params.set('columns', defaultVisibleColumns(reportKey).join(','));
                }, true);
              }}
            />
          </div>
        </div>

        {/* What this report is showing, in words, so a shared link explains
            itself and matches the block at the top of the exported file. */}
        <p className="text-muted-foreground text-xs">
          {captions.map((caption) => `${caption.label}: ${caption.value}`).join('  ·  ')}
        </p>

        {/* Sort is on the toolbar rather than on the header cells: at 360px the
            table becomes stacked rows with no header to click. */}
        {definition !== undefined ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Sort</span>
            {definition.columns
              .filter((column) => column.sortField !== undefined)
              .map((column) => {
                const field = column.sortField ?? '';
                const isActive = sort === field || sort === `-${field}`;
                const descending = sort === `-${field}`;
                return (
                  <Button
                    key={field}
                    variant={isActive ? 'secondary' : 'ghost'}
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      toggleSort(field);
                    }}
                  >
                    {column.header}
                    {isActive ? (
                      descending ? (
                        <ArrowDownIcon className="size-3" />
                      ) : (
                        <ArrowUpIcon className="size-3" />
                      )
                    ) : null}
                  </Button>
                );
              })}
          </div>
        ) : null}

        {catalogue.isError ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>The report list could not be loaded</AlertTitle>
            <AlertDescription>
              {catalogue.error.message}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  void catalogue.refetch();
                }}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {active.isPending ? <TableSkeleton /> : null}

        {active.isError ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>This report could not be loaded</AlertTitle>
            <AlertDescription>
              {active.error.message}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  void active.refetch();
                }}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {active.isSuccess && rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartBarIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing in this period</EmptyTitle>
              <EmptyDescription>
                {isFiltered
                  ? 'No row matches these filters. Widen them, or move the period.'
                  : 'This report has no rows for the dates selected. Try a different period.'}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isFiltered) clearFilters();
                  else setFilters({ period: { from: subDays(new Date(), 30), to: new Date() } });
                }}
              >
                {isFiltered ? 'Clear filters' : 'Show the last 30 days'}
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        {rows.length > 0 ? (
          <>
            <RecordTable
              columns={tableColumns}
              rows={rows}
              rowKey={(row) => row.id}
              mobilePrimary={(row) => row.employee.name}
              mobileStatus={(row) =>
                reportKey === 'attendance-register'
                  ? humaniseEnum((row as AttendanceRegisterRow).status)
                  : humaniseEnum((row as PunchAuditRow).type)
              }
              mobileSupporting={(row) => {
                const render = (column: ReportColumnSpec | undefined) =>
                  column === undefined
                    ? EMPTY_VALUE
                    : renderCell(cellFor(row, column.key), column.type);
                return (
                  <span className="flex items-center gap-2">
                    {render(supporting[0])}
                    <span aria-hidden>·</span>
                    {render(supporting[1])}
                  </span>
                );
              }}
              onRowActivate={
                reportKey === 'punch-audit'
                  ? (row) => {
                      setSelectedPunch(row as PunchAuditRow);
                    }
                  : undefined
              }
            />
            <RecordPagination page={page} pageSize={pageSize} total={total} />
          </>
        ) : null}
      </div>

      <ReportSwitcher
        reports={catalogue.data ?? []}
        current={reportKey}
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        onSelect={switchReport}
      />

      <PunchPhotoSheet
        punch={selectedPunch}
        onOpenChange={(open) => {
          if (!open) setSelectedPunch(null);
        }}
      />
    </>
  );
}
