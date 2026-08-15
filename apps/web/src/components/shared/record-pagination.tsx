import type { MouseEvent } from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useLocation, useSearchParams } from 'react-router';

import { ShortcutHint } from '@/components/shared/shortcut-hint';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import { useShortcut } from '@/lib/keyboard/registry';

interface RecordPaginationProps {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * The page window, e.g. `1 … 7 8 9 … 42`.
 *
 * A Set rather than arithmetic on ranges, because the near-the-edge cases
 * (page 1, page 2, the last page) otherwise each need their own branch and the
 * branches are where the off-by-ones live.
 */
function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const wanted = [1, pageCount, page - 1, page, page + 1]
    .filter((candidate) => candidate >= 1 && candidate <= pageCount)
    .sort((a, b) => a - b);

  const out: (number | 'gap')[] = [];
  let previous = 0;
  for (const candidate of wanted) {
    if (candidate === previous) continue;
    if (previous > 0 && candidate - previous > 1) out.push('gap');
    out.push(candidate);
    previous = candidate;
  }
  return out;
}

/**
 * Separate from RecordPagination so the Page Up / Page Down registrations
 * disappear with the controls. A shortcut that stays registered while its hint
 * chip is off screen is exactly the "invisible shortcut" PRD §6.4 forbids, and
 * hooks cannot be called conditionally — so the condition moves up a level and
 * becomes whether this component is mounted at all.
 */
function PageLinks({ page, pageCount }: { page: number; pageCount: number }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();

  function paramsForPage(target: number): URLSearchParams {
    const next = new URLSearchParams(searchParams);
    // Page 1 is the default, so it is left out rather than written in. A
    // shared link to an unpaged list should not carry `?page=1`.
    if (target <= 1) next.delete('page');
    else next.set('page', String(target));
    return next;
  }

  function hrefFor(target: number): string {
    const query = paramsForPage(target).toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  function goTo(target: number) {
    if (target < 1 || target > pageCount || target === page) return;
    setSearchParams(paramsForPage(target));
    // A new page of rows under the previous page's scroll position reads as
    // "nothing happened". Instant, not smooth: NFR-07 asks us not to animate
    // for readers who opted out, and there is nothing to explain here.
    window.scrollTo({ top: 0 });
  }

  function onLinkClick(event: MouseEvent<HTMLAnchorElement>, target: number) {
    // Modified clicks are left to the browser so "open in a new tab" still
    // works on a real link. This is the only reason the controls are anchors
    // with an href rather than buttons.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    goTo(target);
  }

  useShortcut({
    id: 'pagination.previous',
    keys: 'pageup',
    label: 'Previous page',
    scope: 'screen',
    when: () => page > 1,
    run: () => {
      goTo(page - 1);
    },
  });

  useShortcut({
    id: 'pagination.next',
    keys: 'pagedown',
    label: 'Next page',
    scope: 'screen',
    when: () => page < pageCount,
    run: () => {
      goTo(page + 1);
    },
  });

  const previousDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  return (
    <Pagination className="mx-0 w-auto justify-start sm:justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationLink
            size="default"
            aria-label="Previous page"
            aria-disabled={previousDisabled || undefined}
            // Out of the tab order as well as out of reach of the pointer.
            // aria-disabled alone leaves a real anchor that Enter still
            // follows, so a keyboard user gets a stop that announces itself as
            // disabled and then navigates anyway.
            tabIndex={previousDisabled ? -1 : undefined}
            className="pl-1.5! aria-disabled:pointer-events-none aria-disabled:opacity-50"
            href={hrefFor(page - 1)}
            onClick={(event) => {
              onLinkClick(event, page - 1);
            }}
          >
            <CaretLeftIcon data-icon="inline-start" />
            <span className="hidden sm:block">Previous</span>
            {/* Desktop only, following the header's Go To chip: there is no
                keyboard to hint at on a phone, and at 360px the chip pushes
                the control past the viewport. */}
            <ShortcutHint keys="pageup" className="hidden md:inline-flex" />
          </PaginationLink>
        </PaginationItem>

        {/* Numbered pages are a desktop affordance. At 360px they crowd out
            Previous and Next, which are the controls a thumb can actually
            hit; the summary line still says where you are. */}
        {pageWindow(page, pageCount).map((entry, index) =>
          entry === 'gap' ? (
            <PaginationItem key={`gap-${String(index)}`} className="hidden sm:block">
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={entry} className="hidden sm:block">
              <PaginationLink
                isActive={entry === page}
                aria-label={`Page ${String(entry)}`}
                className="tabular-nums"
                href={hrefFor(entry)}
                onClick={(event) => {
                  onLinkClick(event, entry);
                }}
              >
                {entry}
              </PaginationLink>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          <PaginationLink
            size="default"
            aria-label="Next page"
            aria-disabled={nextDisabled || undefined}
            tabIndex={nextDisabled ? -1 : undefined}
            className="pr-1.5! aria-disabled:pointer-events-none aria-disabled:opacity-50"
            href={hrefFor(page + 1)}
            onClick={(event) => {
              onLinkClick(event, page + 1);
            }}
          >
            <ShortcutHint keys="pagedown" className="hidden md:inline-flex" />
            <span className="hidden sm:block">Next</span>
            <CaretRightIcon data-icon="inline-end" />
          </PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

/**
 * The one pagination pattern (CLAUDE.md §3 rule 4), and the place that decides
 * a list's page lives in the URL.
 *
 * The page is read from and written to `?page=` rather than held in component
 * state, so page three of a filtered list is a link somebody can send and a
 * reload lands where it left off. Every list screen gets that by using this
 * component instead of rolling its own.
 *
 * Sits after the content surface, per the PRD §6.2 page structure.
 */
export function RecordPagination({ page, pageSize, total }: RecordPaginationProps) {
  if (total === 0) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div
      data-guide="screen.pagination"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3"
    >
      <p className="text-muted-foreground text-xs tabular-nums">
        {first === last
          ? `Record ${String(first)} of ${String(total)}`
          : `Records ${String(first)}–${String(last)} of ${String(total)}`}
      </p>
      {pageCount > 1 ? <PageLinks page={page} pageCount={pageCount} /> : null}
    </div>
  );
}
