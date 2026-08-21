import { useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarPlusIcon,
  CaretDownIcon,
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
import type { PickerOption } from '@/components/shared/record-picker';
import { RecordPagination } from '@/components/shared/record-pagination';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { EMPTY_VALUE, formatDate, humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  DEFAULT_PAGE_SIZE,
  PERMISSIONS,
  REPORT_KEYS,
  REPORT_DEFINITIONS,
  defaultVisibleColumns,
  describeFilters,
  isReportKey,
  resolveColumns,
  type ExportFormat,
  type ReportColumnSpec,
  type ReportDefinition,
  type ReportFilters,
  type ReportKey,
  type SavedView,
} from '@vyuha/shared';

import {
  useDeleteView,
  useDepartmentOptions,
  useLocationOptions,
  useReportCatalogue,
  useReportRows,
  useRequestExport,
  useSavedViews,
  useSaveView,
  type ReportRowsParams,
} from './api';
import { useParties } from '@/features/masters/use-parties';

import { ColumnChooser } from './column-chooser';
import { ReportFilterBar, type ReportFilterState } from './filter-bar';
import { periodFor, periodModeOf } from './period';
import { ScheduleDialog } from './schedule-dialog';
import { isNumericColumn, renderCell } from './format';
import { PunchPhotoSheet } from './punch-photo-sheet';
import { SavedViews } from './saved-views';
import type { PunchAuditRow, ReportRowView } from './types';

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
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const canExport = usePermission(PERMISSIONS.REPORT_EXPORT);
  const catalogue = useReportCatalogue();
  const departments = useDepartmentOptions();
  const locations = useLocationOptions();


  const reportParam = searchParams.get('report');
  const reportKey: ReportKey = isReportKey(reportParam ?? '')
    ? (reportParam as ReportKey)
    : REPORT_KEYS[0];

  // No fallback to the first report. The columns come from the definition and
  // the cells from `reportKey`, so a definition that is not this report's would
  // paint one report's headers over another's rows -- every cell empty, and
  // reading exactly like a quiet period. A client ahead of its server says so
  // instead.
  const definition = catalogue.data?.find((report) => report.key === reportKey);
  // Phase 6d: only asked for when a report wants a party, and only by
  // somebody who may read the masters — the picker is empty otherwise.
  const canReadParties = usePermission(PERMISSIONS.MASTERS_TALLY_VIEW);
  const wantsParty = definition?.filters.includes('partyId') ?? false;
  const parties = useParties({ page: 1 }, { enabled: canReadParties && wantsParty });
  const partyOptions: PickerOption[] = (parties.data?.data ?? []).map((party) => ({
    id: party.id,
    label: party.name,
    ...(party.gstin === null ? {} : { hint: party.gstin }),
  }));
  const unknownReport = catalogue.isSuccess && definition === undefined;

  // --------------------------------------------------------------- state

  const periodMode = periodModeOf(definition);
  const period: DateRange = periodFor(periodMode, {
    from: fromDateParam(searchParams.get('from')) ?? defaultPeriod().from,
    to: fromDateParam(searchParams.get('to')) ?? defaultPeriod().to,
  });

  const filters: ReportFilterState = {
    period,
    departmentId: searchParams.get('departmentId'),
    locationId: searchParams.get('locationId'),
    employeeId: searchParams.get('employeeId'),
    status: searchParams.get('status'),
    flags: searchParams.get('flags'),
    punchType: searchParams.get('punchType'),
    partyId: searchParams.get('partyId'),
    groupBy: searchParams.get('groupBy'),
    voucherType: searchParams.get('voucherType'),
    ledgerName: searchParams.get('ledgerName'),
    itemName: searchParams.get('itemName'),
  };

  const sort = searchParams.get('sort') ?? definition?.defaultSort ?? '';
  const page = readPositiveInt(searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = DEFAULT_PAGE_SIZE;

  const columnsParam = searchParams.get('columns');
  const visibleColumns = resolveColumns(
    reportKey,
    columnsParam === null ? undefined : columnsParam.split(',').filter(Boolean),
  ).map((column) => column.key);

  const chosenColumns = new Set(visibleColumns);
  const columns: ReportColumnSpec[] =
    definition === undefined
      ? []
      : definition.columns.filter((column) => chosenColumns.has(column.key));

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
      for (const key of ['departmentId', 'locationId', 'employeeId', 'status', 'flags', 'punchType', 'partyId', 'groupBy', 'voucherType', 'ledgerName', 'itemName'] as const) {
        if (!(key in patch)) continue;
        const value = patch[key];
        if (value === null || value === undefined) params.delete(key);
        else params.set(key, value);
      }
    });
  }

  function clearFilters() {
    patchParams((params) => {
      for (const key of ['from', 'to', 'departmentId', 'locationId', 'employeeId', 'status', 'flags', 'punchType', 'partyId', 'groupBy', 'voucherType', 'ledgerName', 'itemName'] as const) {
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
      // The period carries over, narrowed to something the next report can
      // answer for: a quarter handed to the muster grid is a refusal, and a
      // refusal on arrival reads as the report being broken.
      const carried = periodFor(periodModeOf(REPORT_DEFINITIONS[next]), period);
      if (carried.from) params.set('from', toDateParam(carried.from));
      if (carried.to) params.set('to', toDateParam(carried.to));

      /*
       * REQ-N-02: "preserving filters where they apply".
       *
       * Driven by the target's own `filters` declaration rather than a list
       * kept here, which would drift from it the first time a report declares
       * a filter this loop has not heard of. A filter the next report does not
       * declare is dropped rather than carried, because the server would
       * either refuse it or, worse, ignore it -- and a filter silently ignored
       * is a reader believing they are looking at one department when they are
       * looking at all of them.
       *
       * The period is already handled above, and handled differently: it is
       * narrowed to fit rather than passed through.
       */
      for (const name of REPORT_DEFINITIONS[next].filters) {
        if (name === 'period') continue;
        const value = searchParams.get(name);
        if (value !== null && value !== '') params.set(name, value);
      }
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
    ...(filters.partyId ? { partyId: filters.partyId } : {}),
    ...(filters.groupBy ? { groupBy: filters.groupBy as ReportFilters['groupBy'] } : {}),
    ...(filters.voucherType ? { voucherType: filters.voucherType } : {}),
    ...(filters.ledgerName ? { ledgerName: filters.ledgerName } : {}),
    ...(filters.itemName ? { itemName: filters.itemName } : {}),
  };

  // A report that has no answer without a filter is not asked until it has
  // one (customer statement: a party). The prompt below stands in for rows.
  const missingRequired = (definition?.requiredFilters ?? []).filter((name) => {
    if (name === 'partyId') return filters.partyId === null;
    if (name === 'period') return !period.from;
    if (name === 'ledgerName') return filters.ledgerName === null;
    return false;
  });
  // Not until the catalogue has said what the report needs: a statement asked
  // for before its definition arrived would fetch a 400 for a party nobody
  // had a chance to choose.
  const active = useReportRows(reportKey, rowParams, { enabled: definition !== undefined && missingRequired.length === 0 });

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
    ...(filters.partyId ? { partyId: filters.partyId } : {}),
    ...(filters.groupBy ? { groupBy: filters.groupBy as ReportFilters['groupBy'] } : {}),
    ...(filters.voucherType ? { voucherType: filters.voucherType } : {}),
    ...(filters.ledgerName ? { ledgerName: filters.ledgerName } : {}),
    ...(filters.itemName ? { itemName: filters.itemName } : {}),
  };

  function startExport(format: ExportFormat) {
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
        format,
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
    run: () => {
      startExport('XLSX');
    },
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

  const tableColumns: RecordColumn<ReportRowView>[] = columns.map((column) => ({
    key: column.key,
    header: column.header,
    numeric: isNumericColumn(column.type),
    secondary: column.secondary === true,
    cell: (row) => renderCell(row.cells[column.key] ?? null, column.type),
  }));

  // The photo is chrome, not a column: it has no cell in the exported file and
  // must never be one, so it is added to the table rather than to the report's
  // column set (REQ-J-02).
  if (reportKey === 'punch-audit') {
    tableColumns.unshift({
      key: 'photo',
      header: 'Photo',
      className: 'w-16',
      cell: (row) =>
        row.punch === null ? null : (
          <Button
            variant="ghost"
            size="icon"
            aria-label="View the punch photo"
            className="pointer-coarse:size-11"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedPunch(row.punch);
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

  const rows: ReportRowView[] = active.data?.data ?? [];
  const hasStatus = rows.some((row) => row.status !== null);

  const isFiltered =
    filters.departmentId !== null ||
    filters.locationId !== null ||
    filters.employeeId !== null ||
    filters.status !== null ||
    filters.flags !== null ||
    filters.punchType !== null ||
    filters.partyId !== null ||
    filters.groupBy !== null ||
    filters.voucherType !== null ||
    filters.ledgerName !== null ||
    filters.itemName !== null;

  /*
   * REQ-J-05: the same filters without the period.
   *
   * Stripped here rather than left to the server's schema to drop. The request
   * should say what it means, and a payload carrying 01-08 to 31-08 for a
   * schedule that will never use those dates is a payload somebody debugging
   * this will believe.
   */
  const { from: _from, to: _to, ...scheduleFilters } = exportFilters;

  // REQ-L-01, the same formatting the exported file uses, so the caption bar on
  // screen and the header block in the download agree about what a date is.
  const captions = describeFilters(exportFilters, {}, formatDate);

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

            {/*
              REQ-J-03 is titled "Excel export", so Excel is what the button
              does and CSV is the alternative behind the caret -- rather than a
              format Select the reader has to set before every export. Alt+E
              takes the primary action, which is the whole point of a default.
            */}
            <ButtonGroup>
              <Button
                className="gap-2"
                disabled={!canExport || requestExport.isPending}
                onClick={() => {
                  startExport('XLSX');
                }}
              >
                <DownloadSimpleIcon data-icon="inline-start" />
                Export
                <ShortcutHint keys="alt+e" className="hidden md:inline-flex" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      aria-label="Choose an export format"
                      disabled={!canExport || requestExport.isPending}
                    >
                      <CaretDownIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      startExport('XLSX');
                    }}
                  >
                    Excel workbook (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      startExport('CSV');
                    }}
                  >
                    Comma-separated (.csv)
                  </DropdownMenuItem>
                  {/* REQ-J-05, in the export menu rather than as a third
                      toolbar button: it is the same action on a timer, and a
                      third button crowds the header at 360px. */}
                  <DropdownMenuItem
                    onClick={() => {
                      setScheduleOpen(true);
                    }}
                  >
                    <CalendarPlusIcon data-icon="inline-start" />
                    Schedule this report
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
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
            periodMode={periodMode}
            value={filters}
            onChange={setFilters}
            departments={departments.data ?? []}
            locations={locations.data ?? []}
            parties={partyOptions}
            partiesLoading={parties.isPending}
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

        {unknownReport ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>That report is not available to you</AlertTitle>
            <AlertDescription>
              {`"${reportKey}" is not in the catalogue this server offers you — either this build does not have it, or your role holds no permission over what it reports on. Pick another with Ctrl+G.`}
            </AlertDescription>
          </Alert>
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

        {missingRequired.length > 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartBarIcon />
              </EmptyMedia>
              <EmptyTitle>{missingRequired.includes('partyId') ? 'Choose a party' : 'Choose a period'}</EmptyTitle>
              <EmptyDescription>
                {missingRequired.includes('partyId')
                  ? 'A customer statement is for one party. Pick one in the filter bar to see every voucher and the running balance.'
                  : 'This report needs a period.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {active.isPending && !unknownReport && missingRequired.length === 0 ? <TableSkeleton /> : null}

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
              mobilePrimary={(row) => row.primary}
              {...(hasStatus
                ? {
                    mobileStatus: (row: ReportRowView) =>
                      row.status === null ? EMPTY_VALUE : humaniseEnum(row.status),
                  }
                : {})}
              mobileSupporting={(row) => {
                const render = (column: ReportColumnSpec | undefined) =>
                  column === undefined
                    ? EMPTY_VALUE
                    : renderCell(row.cells[column.key] ?? null, column.type);
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
                      setSelectedPunch(row.punch);
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

      <ScheduleDialog
        reportKey={reportKey}
        filters={scheduleFilters}
        columns={visibleColumns}
        sort={sort}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
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
