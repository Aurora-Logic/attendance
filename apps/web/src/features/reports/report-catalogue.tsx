import { useState } from 'react';
import { ArrowRightIcon, ChartBarIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useNavigate, useSearchParams } from 'react-router';

import { REPORT_CATEGORY_ICONS } from '@/components/shared/entity-icons';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { REPORT_CATEGORIES, type ReportCategory, type ReportDefinition } from '@vyuha/shared';

/**
 * The Reports module's front door (REQ-AD-03): every report the caller may
 * see, searchable and grouped by category — never a sixty-item menu. A tile
 * is the report's name and what it answers; opening one is navigation, so
 * the report screen, Go To and the sidebar all address the same URL. The
 * catalogue shows only what the server sent: a report the caller cannot
 * open is not greyed out, it is absent.
 *
 * Tiles, two across from 360px: fifty reports as one column was a
 * five-thousand-pixel scroll on a phone, and each row spent the width on a
 * title that fits in half of it (thumb-reach). The chips carry counts so a
 * reader knows the size of a family before opening it, and each family
 * wears the glyph the sidebar gives it.
 */

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

const TILE_GRID = 'grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-4';

function ReportTile({ report, onOpen }: { report: ReportDefinition; onOpen: () => void }) {
  const Glyph = REPORT_CATEGORY_ICONS[report.category];
  return (
    <Button
      variant="outline"
      onClick={onOpen}
      className="group h-auto min-h-[4.5rem] flex-col items-start justify-start gap-1 px-3 py-2.5 text-left whitespace-normal"
    >
      {/* The title wraps to two lines rather than truncating: at two across
          on a phone "Attendance register" does not fit one, and a label
          cut to "Attendance regis…" names nothing (thumb-reach). */}
      <span className="flex w-full items-start gap-2 font-medium">
        <Glyph className="text-muted-foreground mt-0.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 leading-tight">{report.label}</span>
        <ArrowRightIcon className="text-muted-foreground ml-auto hidden shrink-0 opacity-0 transition-opacity group-hover:opacity-100 sm:block" />
      </span>
      <span className="text-muted-foreground line-clamp-2 text-xs font-normal">{report.description}</span>
    </Button>
  );
}

export function ReportCatalogue({ reports, loading }: { reports: readonly ReportDefinition[]; loading: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category');
  const category = REPORT_CATEGORIES.find((c) => c === categoryParam) ?? null;
  const [q, setQ] = useState('');

  const needle = q.trim().toLowerCase();
  const matches = reports.filter(
    (report) =>
      (category === null || report.category === category) &&
      (needle === '' || `${report.label} ${report.description} ${report.category}`.toLowerCase().includes(needle)),
  );
  const categories = REPORT_CATEGORIES.filter((c) => reports.some((r) => r.category === c));
  const countOf = (c: ReportCategory) => reports.filter((r) => r.category === c).length;
  const grouped = categories
    .map((c) => ({ category: c, reports: matches.filter((r) => r.category === c) }))
    .filter((g) => g.reports.length > 0);

  function open(report: ReportDefinition) {
    void navigate(`/reports?report=${report.key}`);
  }

  return (
    <>
      <PageHeader description="Every report, searchable and grouped. Each one shares the same shell: filters, columns, saved views, export and scheduling." />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon>
              <MagnifyingGlassIcon />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search reports"
              aria-label="Search reports"
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
              }}
            />
          </InputGroup>
          <ToggleGroup
            variant="outline"
            aria-label="Category"
            // One scrolling row on a phone: ten chips wrapped into three rows
            // before the first report; from sm they wrap. w-full on a phone
            // because the group is w-fit, and in this column layout fit-content
            // is the chips' whole width (measured: 1311px at 360) — the
            // scroll container has to be the viewport's width to scroll.
            className="no-scrollbar max-sm:w-full max-sm:flex-nowrap max-sm:overflow-x-auto sm:flex-wrap"
            value={[category ?? 'all']}
            onValueChange={(value: string[]) => {
              const next = value[0];
              setSearchParams(
                (current) => {
                  const params = new URLSearchParams(current);
                  if (next === undefined || next === 'all') params.delete('category');
                  else params.set('category', next);
                  return params;
                },
                { replace: true },
              );
            }}
          >
            <ToggleGroupItem value="all" className="gap-1.5">
              All
              <span className="text-muted-foreground tabular-nums">{reports.length}</span>
            </ToggleGroupItem>
            {categories.map((c) => {
              const Glyph = REPORT_CATEGORY_ICONS[c];
              return (
                <ToggleGroupItem key={c} value={c} className="gap-1.5">
                  <Glyph />
                  {c}
                  <span className="text-muted-foreground tabular-nums">{countOf(c)}</span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>

        {loading ? (
          <div className={TILE_GRID} role="status" aria-busy="true" aria-label="Loading the catalogue">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="h-[4.5rem]" />
            ))}
          </div>
        ) : null}

        {!loading && matches.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartBarIcon />
              </EmptyMedia>
              <EmptyTitle>No report matches</EmptyTitle>
              <EmptyDescription>Try another word, or clear the category. A report you cannot open is not listed.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {grouped.map((group) => {
          const Glyph = REPORT_CATEGORY_ICONS[group.category];
          return (
            <section key={group.category} className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Glyph className="text-muted-foreground" />
                  {group.category}
                  <span className="text-muted-foreground font-normal tabular-nums">{group.reports.length}</span>
                </h2>
                <p className="text-muted-foreground text-xs">{CATEGORY_BLURBS[group.category]}</p>
              </div>
              <div className={TILE_GRID}>
                {group.reports.map((report) => (
                  <ReportTile
                    key={report.key}
                    report={report}
                    onOpen={() => {
                      open(report);
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
