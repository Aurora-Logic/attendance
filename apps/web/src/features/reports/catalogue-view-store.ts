import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * List or cards on the report catalogue.
 *
 * A preference, so localStorage rather than the server: it belongs to this
 * person on this device and losing it costs nothing. Persisted because a view
 * toggle that resets on every visit is worse than no toggle -- somebody who
 * prefers cards would re-pick them fifty times and stop bothering.
 *
 * Not in the URL either. The category filter is, because that is a thing worth
 * sending to a colleague; how you like your own list is not.
 */
export type CatalogueView = 'list' | 'cards';

interface CatalogueViewState {
  view: CatalogueView;
  setView: (view: CatalogueView) => void;
}

export const useCatalogueViewStore = create<CatalogueViewState>()(
  persist(
    (set) => ({
      /*
       * List by default. Fifty-odd reports, and the list is the one that shows
       * what each answers on the same line as its name -- the description is
       * how somebody finds the report they cannot name. Cards trade that for
       * browsing, which is the second thing people do here, not the first.
       */
      view: 'list',
      setView: (view) => {
        set({ view });
      },
    }),
    { name: 'vyuha.catalogue-view' },
  ),
);
