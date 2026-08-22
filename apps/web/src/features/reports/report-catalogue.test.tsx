import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { REPORT_CATEGORIES, type ReportDefinition } from '@vyuha/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-support/render-shell';

import { CATEGORY_TONE } from './category-chip';
import { useCatalogueViewStore } from './catalogue-view-store';
import { ReportCatalogue } from './report-catalogue';

/**
 * Two views of one catalogue.
 *
 * The property worth testing is not that each renders -- it is that they
 * render the *same* reports. A toggle where cards quietly show a different set
 * from the list is worse than having one view, because a person who cannot
 * find a report in cards has no reason to suspect the view rather than their
 * memory.
 */

function report(key: string, label: string, category: ReportDefinition['category']): ReportDefinition {
  return {
    key, label, category,
    description: `What ${label} answers`,
    columns: [],
    defaultSort: '-x',
    filters: [],
  } as unknown as ReportDefinition;
}

const REPORTS = [
  report('daily-muster', 'Daily muster', 'Attendance'),
  report('ageing', 'Ageing', 'Receivables'),
  report('low-stock', 'Below reorder level', 'Inventory'),
];

beforeEach(() => {
  useCatalogueViewStore.setState({ view: 'list' });
});

describe('the report catalogue', () => {
  it('shows every report in the list', () => {
    renderWithProviders(<ReportCatalogue reports={REPORTS} loading={false} />);
    for (const r of REPORTS) {
      expect(screen.getAllByText(r.label).length).toBeGreaterThan(0);
    }
  });

  it('shows the same reports as cards, each one a control', async () => {
    renderWithProviders(<ReportCatalogue reports={REPORTS} loading={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Card view' }));

    for (const r of REPORTS) {
      // A card is a button, not a div with a handler: it takes focus, answers
      // Enter, and announces what it opens.
      const card = screen.getByRole('button', { name: new RegExp(r.label, 'u') });
      expect(within(card).getByText(r.category)).toBeTruthy();
    }
  });

  it('draws the same set in both views, so switching never hides a report', async () => {
    renderWithProviders(<ReportCatalogue reports={REPORTS} loading={false} />);
    const inList = REPORTS.filter((r) => screen.getAllByText(r.label).length > 0).map((r) => r.key);

    await userEvent.click(screen.getByRole('button', { name: 'Card view' }));
    const inCards = REPORTS.filter((r) => screen.queryAllByText(r.label).length > 0).map((r) => r.key);

    expect(inCards).toEqual(inList);
    expect(inCards).toHaveLength(REPORTS.length);
  });

  it('carries the search filter across a view change', async () => {
    renderWithProviders(<ReportCatalogue reports={REPORTS} loading={false} />);
    await userEvent.type(screen.getByLabelText('Search reports'), 'ageing');
    await userEvent.click(screen.getByRole('button', { name: 'Card view' }));

    // The filter belongs to the catalogue, not to a view. Losing it on toggle
    // would send somebody back to a list of fifty.
    expect(screen.getByRole('button', { name: /Ageing/u })).toBeTruthy();
    expect(screen.queryByText('Daily muster')).toBeNull();
  });

  it('says nothing matched, in whichever view is open', async () => {
    renderWithProviders(<ReportCatalogue reports={REPORTS} loading={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Card view' }));
    await userEvent.type(screen.getByLabelText('Search reports'), 'zzzz');

    // An empty grid with no words is indistinguishable from a broken filter.
    expect(screen.getByText('No report matches')).toBeTruthy();
  });

  it('remembers the view, because re-picking it every visit is worse than no toggle', async () => {
    const { unmount } = renderWithProviders(<ReportCatalogue reports={REPORTS} loading={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Card view' }));
    expect(useCatalogueViewStore.getState().view).toBe('cards');
    unmount();

    renderWithProviders(<ReportCatalogue reports={REPORTS} loading={false} />);
    expect(screen.getByRole('button', { name: /Ageing/u })).toBeTruthy();
  });
});

describe('category chips', () => {
  it('gives every category its own colour, none shared', () => {
    // Two categories on one hue is worse than no colour: it says they are the
    // same kind of thing.
    const dots = REPORT_CATEGORIES.map((c) => CATEGORY_TONE[c].dot);
    expect(new Set(dots).size).toBe(REPORT_CATEGORIES.length);
  });

  it('has a tone for every category, so none renders uncoloured', () => {
    for (const category of REPORT_CATEGORIES) {
      expect(CATEGORY_TONE[category], category).toBeDefined();
    }
  });

  it('keeps a category on its own colour whatever else is on screen', () => {
    // Colour follows the entity, never its position. Filtering must not
    // repaint the survivors.
    const { unmount } = renderWithProviders(<ReportCatalogue reports={REPORTS} loading={false} />);
    // The badge itself, not its table cell -- `parentElement` walked one too
    // far and read the cell's padding classes.
    const before = screen.getAllByText('Receivables')[0]?.className ?? '';
    unmount();

    renderWithProviders(<ReportCatalogue reports={REPORTS.slice(1, 2)} loading={false} />);
    const alone = screen.getAllByText('Receivables')[0]?.className ?? '';
    expect(alone).toBe(before);
    expect(before).toContain('amber');
  });

  it('does not dress Exceptions in the destructive colour', () => {
    // An empty exceptions report is the system working, not a fault. Reusing
    // the status red would make a healthy report read as a broken one.
    expect(CATEGORY_TONE.Exceptions.dot).not.toContain('destructive');
  });
});
