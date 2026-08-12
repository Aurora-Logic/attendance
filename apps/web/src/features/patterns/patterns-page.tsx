import { useState } from 'react';
import { CheckIcon, PlusIcon, WarningIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';

/**
 * The Phase 0 shell gallery: one place where the page header, table, form,
 * states, and keyboard behaviour can be seen together and compared.
 *
 * Delivery plan acceptance for Phase 0 requires that "Esc, Ctrl+A, Ctrl+Q
 * behave as specified in a demo form", so this route is that demo. It is
 * mounted in development only — the sample rows below must never reach a
 * production build (CLAUDE.md §6).
 */

interface SampleRow {
  code: string;
  name: string;
  shift: string;
  in: string;
  out: string;
  status: 'Present' | 'Half day' | 'Pending';
  lateMinutes: number;
}

const SAMPLE_ROWS: SampleRow[] = [
  { code: 'E-1004', name: 'A. Nair', shift: 'General', in: '09:02', out: '18:11', status: 'Present', lateMinutes: 0 },
  { code: 'E-1011', name: 'B. Kulkarni', shift: 'General', in: '09:24', out: '18:05', status: 'Present', lateMinutes: 14 },
  { code: 'E-1017', name: 'C. Dsouza', shift: 'General', in: '13:58', out: '18:02', status: 'Half day', lateMinutes: 0 },
  { code: 'E-1023', name: 'D. Menon', shift: 'General', in: '08:57', out: '—', status: 'Pending', lateMinutes: 0 },
];

const STATUS_VARIANT: Record<SampleRow['status'], 'default' | 'secondary' | 'destructive'> = {
  Present: 'secondary',
  'Half day': 'default',
  Pending: 'destructive',
};

const COLUMNS: RecordColumn<SampleRow>[] = [
  { key: 'code', header: 'Code', cell: (r) => <span className="tabular-nums">{r.code}</span> },
  { key: 'name', header: 'Employee', cell: (r) => r.name },
  { key: 'shift', header: 'Shift', cell: (r) => r.shift, secondary: true },
  { key: 'in', header: 'In', cell: (r) => r.in, numeric: true },
  { key: 'out', header: 'Out', cell: (r) => r.out, numeric: true },
  {
    key: 'late',
    header: 'Late (min)',
    cell: (r) => (r.lateMinutes > 0 ? r.lateMinutes : '—'),
    numeric: true,
    secondary: true,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>,
  },
];

export function PatternsPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dirty = name.length > 0 || code.length > 0;

  function save() {
    // Copy rule from PRD §6.6: the toast repeats the action the button named.
    toast.add({
      type: 'success',
      title: 'Demo record saved',
      description: 'Nothing was persisted — there is no API yet.',
    });
    setName('');
    setCode('');
  }

  useShortcut({
    id: 'patterns.save',
    keys: 'ctrl+a',
    label: 'Accept / Save',
    scope: 'screen',
    run: save,
  });

  useShortcut({
    id: 'patterns.quit',
    keys: 'ctrl+q',
    label: 'Quit without saving',
    scope: 'screen',
    run: () => {
      // PRD §6.4: Ctrl+Q quits the screen, confirming if the form is dirty.
      if (dirty) setConfirmOpen(true);
      else void navigate('/');
    },
  });

  useShortcut({
    id: 'patterns.create',
    keys: 'alt+c',
    label: 'Create master on the fly',
    scope: 'screen',
    run: () => {
      toast.add({
        title: 'Create on the fly',
        description: 'Alt+C opens a create dialog from any picker field.',
      });
    },
  });

  return (
    <>
      <PageHeader
        description="Every screen is built from these. Development only."
        action={
          <Button onClick={save}>
            <CheckIcon data-icon="inline-start" />
            Save
            <ShortcutHint keys="ctrl+a" className="ml-1" />
          </Button>
        }
      />

      <Separator />

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Table"
          note="Below 768px this becomes stacked record rows, never a sideways scroll (PRD §6.5). Narrow the window to see it change."
        />
        <RecordTable
          columns={COLUMNS}
          rows={SAMPLE_ROWS}
          rowKey={(r) => r.code}
          mobilePrimary={(r) => r.name}
          mobileStatus={(r) => <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>}
          mobileSupporting={(r) => `${r.code} · ${r.in}–${r.out}`}
          onRowActivate={(r) => {
            toast.add({
              title: `Drill into ${r.name}`,
              description: 'Enter opens the focused row.',
            });
          }}
        />
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Form"
          note="Ctrl+A saves from any field. Ctrl+Q quits and confirms when dirty. Esc clears the focused field."
        />
        <FieldGroup className="max-w-lg">
          <Field>
            <FieldLabel htmlFor="demo-code">Employee code</FieldLabel>
            <Input
              id="demo-code"
              value={code}
              placeholder="E-1024"
              onChange={(e) => {
                setCode(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setCode('');
                }
              }}
            />
            <FieldDescription>Immutable once created (REQ-A-04).</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="demo-name">Name</FieldLabel>
            <Input
              id="demo-name"
              value={name}
              placeholder="Full name"
              onChange={(e) => {
                setName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setName('');
                }
              }}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm">
              <PlusIcon data-icon="inline-start" />
              Create department
              <ShortcutHint keys="alt+c" className="ml-1" />
            </Button>
            <span className="text-muted-foreground text-xs">
              {dirty ? 'Unsaved changes' : 'No changes'}
            </span>
          </div>
        </FieldGroup>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <SectionHeading title="States" note="Loading, error, and empty are built for every screen, not just the happy path." />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2 border p-4">
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Loading
            </span>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-5/6" />
          </div>
          {/* content-start because Alert is a grid and this one is a cell in an
              equal-height row: without it the auto rows stretch to the height
              of the taller loading card and the description drifts away from
              its title. self-start would shrink the box instead; keeping the
              two cards the same height and pinning the text is the better
              trade. */}
          <Alert variant="destructive" className="content-start">
            <WarningIcon />
            <AlertTitle>Could not load attendance</AlertTitle>
            <AlertDescription>
              The server did not respond. Check your connection and try again.
            </AlertDescription>
          </Alert>
        </div>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          {confirmOpen ? (
            <ShortcutLayer id="modal:patterns-quit">
              <DialogHeader>
                <DialogTitle>Leave without saving?</DialogTitle>
                <DialogDescription>
                  This form has unsaved changes. They will be discarded.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirmOpen(false);
                  }}
                >
                  Keep editing
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmOpen(false);
                    void navigate('/');
                  }}
                >
                  Discard and leave
                </Button>
              </DialogFooter>
            </ShortcutLayer>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
