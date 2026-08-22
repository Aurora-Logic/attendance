import { useState } from 'react';
import { ChartBarIcon } from '@phosphor-icons/react';
import { useNavigate, useSearchParams } from 'react-router';

import { REPORT_CATEGORY_ICONS } from '@/components/shared/entity-icons';
import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn, type RecordSort } from '@/components/shared/record-table';
import { SearchField } from '@/components/shared/search-field';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { REPORT_CATEGORIES, type ReportCategory, type ReportDefinition } from '@vyuha/shared';

/**
 * The Reports module's front door (REQ-AD-03): every report the caller may
 * see, as the one list pattern every other register in the product uses —
 * header, toolbar, table; stacked rows on a phone (CLAUDE.md §3 rule 4).
 * Opening one is navigation, so the report screen, Go To and the sidebar
 * all address the same URL. The catalogue shows only what the server sent:
 * a report the caller cannot open is not greyed out, it is absent.
 */

const ALL_CATEGORIES = '__all__';

const CATEGORY_BLURBS: Record<ReportCategory, string> = {
  Attendance: 'Registers, musters and the exceptions of the working day.',
  Approvals: 'Who decided what, how fast, and what is still waiting.',
  Leave: 'Balances, ledgers and what was availed.',
  Books: 'Mirrors of the Tally projection — Vyuha computes nothing here.',
  Receivables: 'Who owes what, against what limit.',
  Customers: 'Buying behaviour: who buys, what, how often, at what rate.',
  Inventory: 'What is on the shelf, how fast it moves, where money sits.',
  Vendors: 'Who supplies what, at what rate, compared.',
  Fulfilment: 'Orders on their way through the warehouse.',
  Exceptions: 'Reports whose ideal state is empty.',
};

/** Categories keep the catalogue's own order, not the alphabet's: Attendance before Vendors is a reading order. */
const CATEGORY_RANK = new Map<ReportCategory, number>(REPORT_CATEGORIES.map((c, index) => [c, index]));

function CategoryCell({ category }: { category: ReportCategory }) {
  const Glyph = REPORT_CATEGORY_ICONS[category];
  return (
    <span className="text-muted-foreground flex items-center gap-1.5">
      <Glyph />
      {category}
    </span>
  );
}

const COLUMNS: RecordColumn<ReportDefinition>[] = [
  {
    key: 'label',
    header: 'Report',
    sortField: 'label',
    cell: (report) => <span className="font-medium">{report.label}</span>,
  },
  {
    key: 'category',
    header: 'Category',
    sortField: 'category',
    className: 'w-40',
    cell: (report) => <CategoryCell category={report.category} />,
  },
  {
    key: 'description',
    header: 'What it answers',
    cell: (report) => <span className="text-muted-foreground">{report.description}</span>,
  },
];

function compareReports(a: ReportDefinition, b: ReportDefinition, sort: RecordSort): number {
  const direction = sort.descending ? -1 : 1;
  if (sort.field === 'category') {
    const byCategory = (CATEGORY_RANK.get(a.category) ?? 0) - (CATEGORY_RANK.get(b.category) ?? 0);
    if (byCategory !== 0) return byCategory * direction;
    return a.label.localeCompare(b.label);
  }
  return a.label.localeCompare(b.label) * direction;
}

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the catalogue" className="border">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} aria-hidden className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
          <Skeleton className="h-3 w-40 shrink-0" />
          <Skeleton className="hidden h-3 w-24 shrink-0 sm:block" />
          <Skeleton className="hidden h-3 w-72 shrink-0 md:block" />
        </div>
      ))}
    </div>
  );
}

export function ReportCatalogue({ reports, loading }: { reports: readonly ReportDefinition[]; loading: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category');
  const category = REPORT_CATEGORIES.find((c) => c === categoryParam) ?? null;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<RecordSort>({ field: 'category', descending: false });

  const needle = q.trim().toLowerCase();
  const categories = REPORT_CATEGORIES.filter((c) => reports.some((r) => r.category === c));
  const countOf = (c: ReportCategory) => reports.filter((r) => r.category === c).length;
  const rows = reports
    .filter(
      (report) =>
        (category === null || report.category === category) &&
        (needle === '' || `${report.label} ${report.description} ${report.category}`.toLowerCase().includes(needle)),
    )
    .sort((a, b) => compareReports(a, b, sort));

  function open(report: ReportDefinition) {
    void navigate(`/reports?report=${report.key}`);
  }

  return (
    <>
      <PageHeader description="Every report, searchable and grouped. Each one shares the same shell: filters, columns, saved views, export and scheduling." />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            id="report-search"
            label="Search reports"
            value={q}
            onValueChange={setQ}
            placeholder="Name, or what it answers"
          />
          <Select
            value={category ?? ALL_CATEGORIES}
            onValueChange={(value: string | null) => {
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  if (value === null || value === ALL_CATEGORIES) next.delete('category');
                  else next.set('category', value);
                  return next;
                },
                { replace: true },
              );
            }}
          >
            <SelectTrigger className="w-48" aria-label="Category">
              <SelectValue>
                {(value: string) =>
                  value === ALL_CATEGORIES
                    ? `All categories · ${String(reports.length)}`
                    : `${value} · ${String(countOf(value as ReportCategory))}`
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>All categories · {reports.length}</SelectItem>
              {categories.map((c) => {
                const Glyph = REPORT_CATEGORY_ICONS[c];
                return (
                  <SelectItem key={c} value={c}>
                    <Glyph />
                    {c} · {countOf(c)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {category !== null ? <p className="text-muted-foreground text-xs">{CATEGORY_BLURBS[category]}</p> : null}
        </div>

        {loading ? <ListSkeleton /> : null}

        {!loading ? (
          <RecordTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(report) => report.key}
            sort={sort}
            onSortChange={setSort}
            onRowActivate={open}
            mobilePrimary={(report) => report.label}
            mobileStatus={(report) => <Badge variant="outline">{report.category}</Badge>}
            mobileSupporting={(report) => <span className="line-clamp-2">{report.description}</span>}
            emptyState={
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ChartBarIcon />
                  </EmptyMedia>
                  <EmptyTitle>No report matches</EmptyTitle>
                  <EmptyDescription>Try another word, or clear the category. A report you cannot open is not listed.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
          />
        ) : null}
      </div>
    </>
  );
}
