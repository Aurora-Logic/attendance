import { useState } from 'react';
import type { DocumentSettings } from '@vyuha/shared';

import { useDocumentSettings } from './use-document-settings';

/** The design working copy every document page holds: the server's, until the rail edits it. */
export function useDesignDraft(): { draft: DocumentSettings; setDraft: (next: DocumentSettings) => void; saved: DocumentSettings } | null {
  const settings = useDocumentSettings();
  const [draft, setDraft] = useState<DocumentSettings | null>(null);
  const [base, setBase] = useState<DocumentSettings | null>(null);
  if (settings.data !== undefined && base !== settings.data) {
    // The server's copy moved (someone saved elsewhere): adopt it unless this rail has unsaved edits.
    setBase(settings.data);
    if (draft === null || JSON.stringify(draft) === JSON.stringify(base)) setDraft(settings.data);
  }
  if (draft === null || settings.data === undefined) return null;
  return { draft, setDraft, saved: settings.data };
}
