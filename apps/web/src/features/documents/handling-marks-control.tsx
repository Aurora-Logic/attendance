import { HANDLING_MARKS, HANDLING_MARK_LABELS, type DocumentSettings, type HandlingMark, type PrintedDocumentType } from '@vyuha/shared';

import { HANDLING_MARK_ICONS } from '@/components/shared/entity-icons';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from '@/components/ui/toast';

/**
 * The handling marks, switched on right on the slip — no trip into the Design
 * rail (owner, 22 Aug: better UX). Each mark is a tappable glyph chip; a tap
 * saves the organisation's design at once, so the paper beside it updates and
 * every future slip prints the same. Read-only for anyone without settings
 * rights: they see which marks are on, they cannot change them.
 */
export function HandlingMarksControl({
  docType,
  settings,
  onDraft,
  onSave,
  canManage,
}: {
  docType: PrintedDocumentType;
  settings: DocumentSettings;
  onDraft: (next: DocumentSettings) => void;
  onSave: (next: DocumentSettings) => void;
  canManage: boolean;
}) {
  const marks = settings.designs[docType].handlingMarks;

  function setMarks(next: readonly HandlingMark[]) {
    const draft: DocumentSettings = {
      ...settings,
      designs: { ...settings.designs, [docType]: { ...settings.designs[docType], handlingMarks: [...next] } },
    };
    onDraft(draft);
    onSave(draft);
  }

  if (!canManage) {
    if (marks.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground font-medium">Handling marks</span>
        {marks.map((mark) => {
          const Glyph = HANDLING_MARK_ICONS[mark];
          return (
            <span key={mark} className="inline-flex items-center gap-1.5 border px-2 py-1">
              <Glyph />
              {HANDLING_MARK_LABELS[mark]}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs font-medium">Handling marks — tap the ones this slip should print</span>
      <ToggleGroup
        variant="outline"
        multiple
        aria-label="Handling marks"
        className="flex-wrap justify-start"
        value={[...marks]}
        onValueChange={(value: string[]) => {
          setMarks(HANDLING_MARKS.filter((mark) => value.includes(mark)));
          toast.add({ type: 'success', title: 'Handling marks saved', description: 'Every slip prints these now.' });
        }}
      >
        {HANDLING_MARKS.map((mark) => {
          const Glyph = HANDLING_MARK_ICONS[mark];
          return (
            <ToggleGroupItem key={mark} value={mark} aria-label={HANDLING_MARK_LABELS[mark]} className="gap-1.5 data-pressed:border-primary">
              <Glyph />
              {HANDLING_MARK_LABELS[mark]}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
