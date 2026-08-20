import { useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { Form } from '@/components/shared/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useIsMobile } from '@/hooks/use-mobile';

import type { Pipeline, PipelineStage } from './types';
import { useDeletePipelineStage, useReorderPipelineStages, useSavePipelineStage } from './use-deals';

/**
 * REQ-U-04: the pipeline's stages are configuration. Rename, set the
 * probability, mark the ends as won or lost, reorder, add, remove — the
 * board columns sheet's shape, for the same reasons.
 */
export function PipelineSheet({ pipeline, open, onOpenChange }: { pipeline: Pipeline | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 sm:max-w-md max-md:max-h-[90vh]">
        <SheetHeader className="shrink-0 border-b">
          <SheetTitle>{pipeline === null ? 'Pipeline' : `${pipeline.name} stages`}</SheetTitle>
          <SheetDescription>
            A deal&rsquo;s stage is its status. Moving a deal into a won or lost stage closes it.
          </SheetDescription>
        </SheetHeader>
        {open && pipeline !== null ? <StagesBody pipeline={pipeline} /> : null}
      </SheetContent>
    </Sheet>
  );
}

type Outcome = 'open' | 'won' | 'lost';
const OUTCOME_LABELS: Record<Outcome, string> = { open: 'Open', won: 'Won', lost: 'Lost' };
const outcomeOf = (stage: PipelineStage): Outcome => (stage.isWon ? 'won' : stage.isLost ? 'lost' : 'open');

function StagesBody({ pipeline }: { pipeline: Pipeline }) {
  const save = useSavePipelineStage();
  const reorder = useReorderPipelineStages();
  const remove = useDeletePipelineStage();
  const [newName, setNewName] = useState('');
  const list = pipeline.stages;
  const failure = save.error ?? reorder.error ?? remove.error;
  const copy = actionErrorCopy(failure, 'Changing the pipeline');

  function move(index: number, delta: -1 | 1) {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(target, 0, item);
    reorder.mutate({ pipelineId: pipeline.id, stageIds: next.map((s) => s.id) });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <FieldGroup>
        {failure ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription>{copy.description}</AlertDescription>
          </Alert>
        ) : null}

        <ul className="divide-y border">
          {list.map((stage, index) => (
            <StageRow
              key={stage.id}
              stage={stage}
              first={index === 0}
              last={index === list.length - 1}
              busy={save.isPending || reorder.isPending || remove.isPending}
              onSave={(patch) => {
                save.mutate({ pipelineId: pipeline.id, id: stage.id, name: stage.name, probability: stage.probability, isWon: stage.isWon, isLost: stage.isLost, ...patch });
              }}
              onUp={() => {
                move(index, -1);
              }}
              onDown={() => {
                move(index, 1);
              }}
              onRemove={() => {
                remove.mutate(
                  { pipelineId: pipeline.id, id: stage.id },
                  {
                    onSuccess: () => {
                      toast.add({ type: 'success', title: `${stage.name} removed` });
                    },
                  },
                );
              }}
            />
          ))}
        </ul>

        <Form
          onSubmit={() => {
            if (newName.trim() === '') return;
            save.mutate(
              { pipelineId: pipeline.id, name: newName, probability: 50, isWon: false, isLost: false },
              {
                onSuccess: (created) => {
                  toast.add({ type: 'success', title: `${created.name} added` });
                  setNewName('');
                },
              },
            );
          }}
        >
          <Field>
            <FieldLabel htmlFor="new-stage-name">New stage</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="new-stage-name"
                className="pointer-coarse:h-11"
                placeholder="Demo given"
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value);
                }}
              />
              <Button type="submit" variant="outline" disabled={save.isPending || newName.trim() === ''}>
                {save.isPending ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                Add
              </Button>
            </div>
            <FieldDescription>Added last, open, at 50%. Move it and set its probability from the row.</FieldDescription>
          </Field>
        </Form>
      </FieldGroup>
    </div>
  );
}

function StageRow({
  stage,
  first,
  last,
  busy,
  onSave,
  onUp,
  onDown,
  onRemove,
}: {
  stage: PipelineStage;
  first: boolean;
  last: boolean;
  busy: boolean;
  onSave: (patch: Partial<{ name: string; probability: number; isWon: boolean; isLost: boolean }>) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(stage.name);
  const [probability, setProbability] = useState(String(stage.probability));
  const outcome = outcomeOf(stage);

  function commitName() {
    if (name.trim() === '' || name.trim() === stage.name) return;
    onSave({ name: name.trim() });
  }
  function commitProbability() {
    const parsed = Number(probability);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100 || parsed === stage.probability) {
      setProbability(String(stage.probability));
      return;
    }
    onSave({ probability: parsed });
  }

  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <Input
        aria-label={`Name of ${stage.name}`}
        className="pointer-coarse:h-11 min-w-32 flex-1"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitName();
          }
        }}
      />
      <Input
        aria-label={`Probability of ${stage.name}`}
        inputMode="numeric"
        className="pointer-coarse:h-11 w-16 tabular-nums"
        value={probability}
        onChange={(event) => {
          setProbability(event.target.value);
        }}
        onBlur={commitProbability}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitProbability();
          }
        }}
      />
      <Select
        value={outcome}
        onValueChange={(next: string | null) => {
          if (next === 'open') onSave({ isWon: false, isLost: false });
          else if (next === 'won') onSave({ isWon: true, isLost: false });
          else if (next === 'lost') onSave({ isWon: false, isLost: true });
        }}
      >
        <SelectTrigger aria-label={`Outcome of ${stage.name}`} className="pointer-coarse:h-11 w-24" disabled={busy}>
          <SelectValue>{(value: Outcome) => OUTCOME_LABELS[value]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(['open', 'won', 'lost'] as const).map((o) => (
            <SelectItem key={o} value={o}>
              {OUTCOME_LABELS[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="flex items-center">
        <Button variant="ghost" size="icon-sm" aria-label={`Move ${stage.name} up`} disabled={busy || first} onClick={onUp}>
          <ArrowUpIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Move ${stage.name} down`} disabled={busy || last} onClick={onDown}>
          <ArrowDownIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${stage.name}`} disabled={busy} onClick={onRemove}>
          <TrashIcon />
        </Button>
      </span>
    </li>
  );
}
