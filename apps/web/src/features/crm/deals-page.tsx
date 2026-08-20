import { useEffect, useState } from 'react';
import { GearIcon, HandshakeIcon, KanbanIcon, ListBulletsIcon, LockKeyIcon, PlusIcon } from '@phosphor-icons/react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { KanbanBoard } from '@/components/shared/kanban-board';
import { PageHeader } from '@/components/shared/page-header';
import { RecordPagination } from '@/components/shared/record-pagination';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SearchField } from '@/components/shared/search-field';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from '@/components/ui/toast';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { useTaskViewStore, type TaskViewMode } from '@/features/tasks/task-view-store';
import { useIsMobile } from '@/hooks/use-mobile';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { cn } from '@/lib/utils';
import { DEAL_STATUSES, PERMISSIONS, type DealStatusFilter } from '@vyuha/shared';

import { DealSheet } from './deal-sheet';
import { PipelineSheet } from './pipeline-sheet';
import { dealToDraft, emptyDealDraft, type Deal, type DealDraft } from './types';
import { useDeal, useDealBoard, useDeals, useMoveDeal, usePipelines, type DealFilters } from './use-deals';

/**
 * Deals (REQ-U-05): the pipeline as a list or a board, one filter set for
 * both, the same way tasks work — including the default-view preference,
 * which is shared with tasks on purpose: a person who likes boards likes
 * boards.
 */

const STATUS_LABELS: Record<DealStatusFilter, string> = { open: 'Open', won: 'Won', lost: 'Lost', all: 'All' };

/** en-IN grouping (last three, then twos) for a figure that is read, never computed on. */
function formatValue(value: string | null): string {
  if (value === null) return EMPTY_VALUE;
  const [whole = '0', fraction] = value.split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest === '' ? last3 : `${rest.replace(/\B(?=(\d{2})+(?!\d))/gu, ',')},${last3}`;
  return fraction === undefined || /^0*$/u.test(fraction) ? grouped : `${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

const COLUMNS: RecordColumn<Deal>[] = [
  {
    key: 'name',
    header: 'Deal',
    cell: (row) => (
      <span className="flex items-center gap-2">
        <span className="font-medium">{row.name}</span>
        {row.status === 'won' ? <Badge>Won</Badge> : row.status === 'lost' ? <Badge variant="outline">Lost</Badge> : null}
      </span>
    ),
  },
  { key: 'company', header: 'Company', cell: (row) => row.companyName ?? EMPTY_VALUE },
  { key: 'stage', header: 'Stage', cell: (row) => `${row.stageName} · ${String(row.probability)}%` },
  { key: 'value', header: 'Value', cell: (row) => formatValue(row.value), numeric: true },
  { key: 'close', header: 'Expected close', cell: (row) => formatDate(row.expectedCloseDate), className: 'tabular-nums', secondary: true },
  { key: 'owner', header: 'Owner', cell: (row) => row.ownerName ?? EMPTY_VALUE, secondary: true },
];

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading deals" className="border">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} aria-hidden className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
          <Skeleton className="h-3 w-48 shrink-0" />
          <Skeleton className="hidden h-3 w-24 shrink-0 sm:block" />
          <Skeleton className="ml-auto h-3 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function isStatus(value: string | null): value is DealStatusFilter {
  return DEAL_STATUSES.some((s) => s === value);
}

export function DealsPage() {
  const canViewSelf = usePermission(PERMISSIONS.CRM_DEAL_VIEW_SELF);
  const canViewAll = usePermission(PERMISSIONS.CRM_DEAL_VIEW_ALL);
  const canView = canViewSelf || canViewAll;
  const canManage = usePermission(PERMISSIONS.CRM_DEAL_MANAGE);
  const canConfigure = usePermission(PERMISSIONS.CRM_PIPELINE_MANAGE);
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const defaultView = useTaskViewStore((s) => s.defaultView);
  const setDefaultView = useTaskViewStore((s) => s.setDefaultView);
  const [configuring, setConfiguring] = useState(false);

  const q = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const statusParam = searchParams.get('status');
  const status: DealStatusFilter = isStatus(statusParam) ? statusParam : 'open';
  const pipelineParam = searchParams.get('pipeline') ?? '';
  const viewParam = searchParams.get('view');
  const view: TaskViewMode = isMobile ? 'list' : viewParam === 'board' || viewParam === 'list' ? viewParam : defaultView;
  const openId = params.id ?? null;
  const creating = searchParams.get('new') === '1';
  const companyParam = searchParams.get('company') ?? '';

  const [draft, setDraft] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (syncedQ !== q) {
    setSyncedQ(q);
    if (draft.trim() !== q) setDraft(q);
  }
  useEffect(() => {
    if (draft.trim() === q) return undefined;
    const timer = window.setTimeout(() => {
      setParam('q', draft.trim() || null);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setParam is stable in effect
  }, [draft, q]);

  function setParam(name: string, value: string | null) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === null) next.delete(name);
        else next.set(name, value);
        if (name !== 'page' && name !== 'view') next.delete('page');
        return next;
      },
      { replace: true },
    );
  }

  const pipelines = usePipelines({ enabled: canView });
  const pipelineList = pipelines.data ?? [];
  const pipeline = pipelineList.find((p) => p.id === pipelineParam) ?? pipelineList.find((p) => p.isDefault) ?? pipelineList[0] ?? null;

  const filters: DealFilters = {
    ...(q ? { q } : {}),
    ...(status === 'open' ? {} : { status }),
    ...(pipeline === null ? {} : { pipelineId: pipeline.id }),
    ...(companyParam ? { companyId: companyParam } : {}),
  };

  const list = useDeals({ ...filters, page }, { enabled: canView && view === 'list' });
  const board = useDealBoard(filters, { enabled: canView && view === 'board' && pipeline !== null });
  const open = useDeal(canView ? openId : null);
  const move = useMoveDeal();

  function startNew() {
    setParam('new', '1');
  }
  function closeSheet() {
    const next = new URLSearchParams(window.location.search);
    next.delete('new');
    const search = next.toString();
    void navigate(`/crm/deals${search ? `?${search}` : ''}`, { replace: true });
  }

  useShortcut({
    id: 'crm.deals.create',
    keys: 'alt+c',
    label: 'New deal',
    scope: 'screen',
    when: () => canManage,
    run: startNew,
  });

  const sheetDraft: DealDraft | null = creating
    ? emptyDealDraft({ ...(pipeline === null ? {} : { pipelineId: pipeline.id }), ...(companyParam ? { companyId: companyParam } : {}) })
    : open.data !== undefined && openId !== null
      ? dealToDraft(open.data)
      : null;

  if (!canView) {
    return (
      <>
        <PageHeader description="The pipeline: what is being sold, to whom, and how far along." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockKeyIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot view deals</EmptyTitle>
            <EmptyDescription>This needs crm.deal.view.self or crm.deal.view.all. Ask an administrator for the Sales role.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  const rows = list.data?.data ?? [];
  const meta = list.data?.meta ?? null;
  const query = view === 'list' ? list : board;
  const nothing = view === 'list' ? list.isSuccess && rows.length === 0 : board.isSuccess && board.data.lanes.every((l) => l.deals.length === 0);
  const filtered = Boolean(q) || status !== 'open' || Boolean(companyParam);

  return (
    <>
      <PageHeader
        description="What is being sold, to whom, and how far along. A deal has no accounting existence; when it is won, its company is linked to the Tally party that invoices it."
        action={
          canManage ? (
            <Button size="sm" onClick={startNew}>
              <PlusIcon data-icon="inline-start" />
              New deal
              <ShortcutHint keys="alt+c" className="ml-1 hidden md:inline-flex" />
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField id="deal-search" label="Search deals" value={draft} onValueChange={setDraft} placeholder="Deal name or notes" />

          {pipelineList.length > 1 ? (
            <Select
              value={pipeline?.id ?? ''}
              onValueChange={(value: string | null) => {
                setParam('pipeline', value);
              }}
            >
              <SelectTrigger className="pointer-coarse:min-h-11 w-40" aria-label="Pipeline">
                <SelectValue>{(value: string) => pipelineList.find((p) => p.id === value)?.name ?? 'Pipeline'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {pipelineList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {view === 'list' ? (
            <ToggleGroup
              variant="outline"
              aria-label="Status"
              value={[status]}
              onValueChange={(value) => {
                const next = value[0];
                if (isStatus(next)) setParam('status', next === 'open' ? null : next);
              }}
            >
              {DEAL_STATUSES.map((s) => (
                <ToggleGroupItem key={s} value={s} className="pointer-coarse:h-11">
                  {STATUS_LABELS[s]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {canConfigure && pipeline !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfiguring(true);
                }}
              >
                <GearIcon data-icon="inline-start" />
                Stages
              </Button>
            ) : null}
            {isMobile ? null : (
              <ToggleGroup
                variant="outline"
                aria-label="View"
                value={[view]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === 'list' || next === 'board') {
                    setParam('view', next);
                    setDefaultView(next);
                  }
                }}
              >
                <ToggleGroupItem value="list" aria-label="List view">
                  <ListBulletsIcon />
                </ToggleGroupItem>
                <ToggleGroupItem value="board" aria-label="Board view">
                  <KanbanIcon />
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
        </div>

        {query.isPending || (view === 'board' && pipelines.isPending) ? <ListSkeleton /> : null}

        {query.isError ? (
          <QueryErrorAlert
            error={query.error}
            subject="deals"
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : null}

        {nothing ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HandshakeIcon />
              </EmptyMedia>
              <EmptyTitle>{filtered ? 'No deal matches that' : 'No open deals'}</EmptyTitle>
              <EmptyDescription>
                {filtered ? 'Try another status or clear the search.' : canManage ? 'Add the first one — a name and a company are enough to start.' : 'Deals appear here as the sales team adds them.'}
              </EmptyDescription>
            </EmptyHeader>
            {!filtered && canManage ? (
              <EmptyContent>
                <Button size="sm" onClick={startNew}>
                  <PlusIcon data-icon="inline-start" />
                  New deal
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : null}

        {view === 'list' && rows.length > 0 ? (
          <>
            <RecordTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              mobilePrimary={(row) => row.name}
              mobileStatus={(row) => <Badge variant={row.status === 'won' ? 'default' : 'outline'}>{row.status === 'open' ? row.stageName : STATUS_LABELS[row.status]}</Badge>}
              mobileSupporting={(row) => [row.companyName, formatValue(row.value)].filter((p): p is string => p !== null && p !== EMPTY_VALUE).join(' · ') || EMPTY_VALUE}
              onRowActivate={(row) => {
                void navigate(`/crm/deals/${row.id}${window.location.search}`);
              }}
            />
            {meta !== null && meta.total > meta.pageSize ? (
              <RecordPagination page={meta.page} pageSize={meta.pageSize} total={meta.total} />
            ) : null}
          </>
        ) : null}

        {view === 'board' && board.data !== undefined && !nothing ? (
          <KanbanBoard
            ariaLabel="Deal pipeline"
            lanes={board.data.lanes.map(({ stage, deals, total, valueTotal }) => ({
              id: stage.id,
              label: stage.name,
              title: (
                <>
                  {stage.name}
                  <span className="text-muted-foreground text-xs font-normal">{stage.isWon ? 'won' : stage.isLost ? 'lost' : `${String(stage.probability)}%`}</span>
                </>
              ),
              meta: (
                <span className="flex items-baseline gap-2">
                  <span>{total}</span>
                  <span className="text-muted-foreground">{formatValue(valueTotal)}</span>
                </span>
              ),
              items: deals,
              total,
              muted: stage.isWon || stage.isLost,
            }))}
            itemKey={(deal) => deal.id}
            itemLaneId={(deal) => deal.stageId}
            itemLabel={(deal) => deal.name}
            renderItem={(deal) => (
              <>
                <span className={cn('font-medium', deal.status === 'lost' && 'text-muted-foreground line-through')}>{deal.name}</span>
                <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal">
                  {deal.companyName === null ? null : <span>{deal.companyName}</span>}
                  {deal.value === null ? null : <span className="tabular-nums">{formatValue(deal.value)}</span>}
                  {deal.expectedCloseDate === null ? null : <span className="tabular-nums">{formatDate(deal.expectedCloseDate)}</span>}
                  {deal.ownerName === null ? null : <span>{deal.ownerName}</span>}
                </span>
              </>
            )}
            onOpen={(deal) => {
              void navigate(`/crm/deals/${deal.id}${window.location.search}`);
            }}
            onMove={(deal, stageId) => {
              const lane = board.data?.lanes.find((l) => l.stage.id === stageId);
              move.mutate(
                { id: deal.id, stageId },
                {
                  onSuccess: (moved) => {
                    toast.add({
                      type: 'success',
                      title: moved.status === 'won' && deal.status !== 'won' ? 'Deal won' : moved.status === 'lost' && deal.status !== 'lost' ? 'Deal marked lost' : `Moved to ${lane?.stage.name ?? moved.stageName}`,
                      description: moved.name,
                    });
                    if (moved.status === 'won' && moved.companyId !== null && moved.partyId === null) {
                      void navigate(`/crm/deals/${moved.id}${window.location.search}`);
                    }
                  },
                  onError: (error) => {
                    toast.add({ type: 'error', title: 'Could not move the deal', description: error.message });
                  },
                },
              );
            }}
            moving={move.isPending}
            overflowHint="see the list"
          />
        ) : null}
      </div>

      {openId !== null && open.isError ? (
        <QueryErrorAlert
          error={open.error}
          subject="that deal"
          onRetry={() => {
            void open.refetch();
          }}
        />
      ) : null}

      <DealSheet
        draft={sheetDraft}
        record={open.data ?? null}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeSheet();
        }}
      />
      <PipelineSheet pipeline={pipeline} open={configuring} onOpenChange={setConfiguring} />
    </>
  );
}
