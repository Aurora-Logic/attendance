import { useState } from 'react';
import { ArrowRightIcon, ChartBarIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useNavigate, useSearchParams } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { REPORT_CATEGORIES, type ReportCategory, type ReportDefinition } from '@vyuha/shared';

/**
 * The Reports module's front door (REQ-AD-03): every report the caller may
 * see, searchable and grouped by category — never a sixty-item menu. A card
 * is the report's name and what it answers; opening one is navigation, so
 * the report screen, Go To and the sidebar all address the same URL. The
 * catalogue shows only what the server sent: a report the caller cannot
 * open is not greyed out, it is absent.
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
  const grouped = categories
    .map((c) => ({ category: c, reports: matches.filter((r) => r.category === c) }))
    .filter((g) => g.reports.length > 0);

  function open(report: ReportDefinition) {
    void navigate(`/reports?report=${report.key}`);
  }

  return (
    <>
      <PageHeader description="Every report, searchable and grouped. Each one shares the same shell: filters, columns, saved views, export and scheduling." />
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="w-full sm:w-80">
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
            className="flex-wrap"
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
            <ToggleGroupItem value="all" className="pointer-coarse:h-11">
              All
            </ToggleGroupItem>
            {categories.map((c) => (
              <ToggleGroupItem key={c} value={c} className="pointer-coarse:h-11">
                {c}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {loading ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
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

        {grouped.map((group) => (
          <section key={group.category} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="text-sm font-semibold">{group.category}</h2>
              <p className="text-muted-foreground text-xs">{CATEGORY_BLURBS[group.category]}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {group.reports.map((report) => (
                <Button
                  key={report.key}
                  variant="outline"
                  onClick={() => {
                    open(report);
                  }}
                  className={cn(
                    'group h-auto flex-col items-start gap-1 rounded-lg px-4 py-3 text-left whitespace-normal',
                    'hover:border-primary/40 hover:shadow-sm',
                  )}
                >
                  <span className="flex w-full items-center gap-2 font-medium">
                    <ChartBarIcon className="text-muted-foreground shrink-0" />
                    <span className="min-w-0 truncate">{report.label}</span>
                    <ArrowRightIcon className="text-muted-foreground ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                  <span className="text-muted-foreground line-clamp-2 text-xs font-normal">{report.description}</span>
                </Button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
