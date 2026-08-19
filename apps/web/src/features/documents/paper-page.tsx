import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useParty } from '@/features/masters/use-parties';
import type { PrintedDocumentType } from '@vyuha/shared';

import { DocumentEditor } from './document-editor';
import { paperModelOf, type PaperRecord } from './paper-record';
import { useDesignDraft } from './use-design-draft';

/**
 * A document that is read, not typed: the delivery note, the packing slip,
 * the goods receipt. The page mounts the same shell the editable papers
 * wear — the paper, PDF, Excel, the design rail — with the record read
 * into the shared paper shape and the party fetched for its address and
 * GSTIN. The page that owns the record hands in its badges, verbs and
 * what sits beneath the paper.
 */
export function PaperPage({ docType, record, backTo, backLabel, title, badges, actions, extras, failure, printPath, excel }: { docType: PrintedDocumentType; record: PaperRecord; backTo: string; backLabel: string; title: string; badges?: ReactNode; actions?: ReactNode; extras?: ReactNode; failure?: { title: string; description: string } | null; printPath: string; excel: { path: string; filename: string } }) {
  const settings = useDesignDraft();
  const party = useParty(record.partyId);
  if (settings === null) return <PaperPageSkeleton label={`Loading the ${title.toLowerCase()}`} />;
  return (
    <DocumentEditor
      docType={docType}
      backTo={backTo}
      backLabel={backLabel}
      title={title}
      badges={badges}
      dirty={false}
      failure={failure ?? null}
      hint={null}
      model={paperModelOf(docType, record, party.data)}
      printPath={printPath}
      excel={excel}
      settings={settings}
      extras={extras}
      actions={actions}
    />
  );
}

export function PaperPageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-4">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mx-auto h-[420px] w-full max-w-[210mm]" />
    </div>
  );
}
