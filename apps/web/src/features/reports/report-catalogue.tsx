import { useState } from 'react';
import { ChartBarIcon, ListIcon, SquaresFourIcon } from '@phosphor-icons/react';
import { useNavigate, useSearchParams } from 'react-router';

import { REPORT_CATEGORY_ICONS } from '@/components/shared/entity-icons';
import { PageHeader } from '@/components/shared/page-header';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CategoryChip } from './category-chip';
import { useCatalogueViewStore } from './catalogue-view-store';
import { RecordTable, type RecordColumn, type RecordSort } from '@/components/shared/record-table';
import { SearchField } from '@/components/shared/search-field';
import { Button } from '@/components/ui/button';
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
  // The chip, not an icon and a word. Three places name a category -- this
  // cell, the phone row and the card -- and they were three renderings of the
  // same fact, which is three chances to drift.
  return <CategoryChip category={category} />;
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

/**
 * One report as a card.
 *
 * A button rather than a div with a click handler, because it is a control:
 * it takes focus in order, answers Enter and Space, and announces itself. The
 * whole card is the target -- a card whose title alone is clickable teaches
 * people to aim.
 *
 * Not nested in another card (CLAUDE.md section 3): the grid sits directly on
 * the page surface, so this is the only box.
 */
function ReportCard({ report, onOpen }: { report: ReportDefinition; onOpen: () => void }) {
  const Glyph = REPORT_CATEGORY_ICONS[report.category];
  return (
    <Button
      variant="outline"
      onClick={onOpen}
      className="hover:border-foreground/30 hover:bg-accent/40 h-auto min-w-0 flex-col items-start gap-2 whitespace-normal p-4 text-left"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <Glyph className="text-muted-foreground shrink-0" />
        {/* Wraps rather than truncates: a report nobody can read the name of
            is a report nobody opens, and the grid has the height to give. */}
        <span className="min-w-0 flex-1 text-sm font-medium">{report.label}</span>
      </span>
      <span className="text-muted-foreground line-clamp-3 text-xs font-normal">
        {report.description}
      </span>
      <CategoryChip category={report.category} className="mt-auto" />
    </Button>
  );
}

function CardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the catalogue" className={CARD_GRID}>
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} aria-hidden className="flex flex-col gap-2 border p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="mt-1 h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Three across at desk width, one on a phone; the cards size themselves. */
const CARD_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3';

export function ReportCatalogue({ reports, loading }: { reports: readonly ReportDefinition[]; loading: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category');
  const category = REPORT_CATEGORIES.find((c) => c === categoryParam) ?? null;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<RecordSort>({ field: 'category', descending: false });
  const view = useCatalogueViewStore((state) => state.view);
  const setView = useCatalogueViewStore((state) => state.setView);

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

          {/* Pushed to the end: the toggle changes how the same rows are drawn,
              so it belongs with the view, not with the filters that decide
              which rows there are. */}
          <ToggleGroup
            variant="outline"
            aria-label="View"
            className="ms-auto"
            value={[view]}
            onValueChange={(next: string[]) => {
              // Base UI hands back an empty array when the active item is
              // pressed again. There is no "no view", so that is ignored
              // rather than blanking the catalogue.
              const chosen = next[0];
              if (chosen === 'list' || chosen === 'cards') setView(chosen);
            }}
          >
            <ToggleGroupItem value="list" aria-label="List view">
              <ListIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="cards" aria-label="Card view">
              <SquaresFourIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {loading ? (view === 'cards' ? <CardSkeleton /> : <ListSkeleton />) : null}

        {/* Cards and the list draw the same `rows`: the same filter, the same
            sort, the same permission set. Only the shape changes, so a person
            who switches view does not silently see a different catalogue. */}
        {!loading && view === 'cards' ? (
          rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartBarIcon />
              </EmptyMedia>
              <EmptyTitle>No report matches</EmptyTitle>
              <EmptyDescription>Try another word, or clear the category. A report you cannot open is not listed.</EmptyDescription>
            </EmptyHeader>
          </Empty>
          ) : (
            <div className={CARD_GRID}>
              {rows.map((report) => (
                <ReportCard
                  key={report.key}
                  report={report}
                  onOpen={() => {
                    open(report);
                  }}
                />
              ))}
            </div>
          )
        ) : null}

        {!loading && view === 'list' ? (
          <RecordTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(report) => report.key}
            sort={sort}
            onSortChange={setSort}
            onRowActivate={open}
            mobilePrimary={(report) => report.label}
            mobileStatus={(report) => <CategoryChip category={report.category} />}
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
