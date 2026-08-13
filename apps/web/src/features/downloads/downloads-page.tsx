import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  HourglassIcon,
  TrayIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Link } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { EXPORT_STATUS_LABELS, PERMISSIONS, type ExportJobSummary } from '@vyuha/shared';
import { usePermission } from '@/lib/session/permissions';

import { useDownloadExport, useExportJobs } from '@/features/reports/api';
import { describeExpiry, formatTimestamp } from '@/features/reports/format';

/**
 * REQ-J-03's Downloads tray: "Exports run as background jobs and land in a
 * Downloads tray with progress and a 7-day retention."
 *
 * A list of rows on the page surface rather than a grid of cards. Each row is
 * one file: what it is, how far along it is, and the one action available to
 * it. No card inside a card (CLAUDE.md §3 rule 3), and the same page structure
 * as every other screen -- header, toolbar, content surface.
 *
 * The tray polls only while something is unfinished (see `useExportJobs`), so a
 * screen of completed files costs one request.
 */

function StatusBadge({ status }: { status: ExportJobSummary['status'] }) {
  if (status === 'DONE') {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircleIcon className="size-3" />
        {EXPORT_STATUS_LABELS.DONE}
      </Badge>
    );
  }
  if (status === 'FAILED') {
    return (
      <Badge variant="destructive" className="gap-1">
        <WarningCircleIcon className="size-3" />
        {EXPORT_STATUS_LABELS.FAILED}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <HourglassIcon className="size-3" />
      {EXPORT_STATUS_LABELS[status]}
    </Badge>
  );
}

function ExportRow({ job }: { job: ExportJobSummary }) {
  const download = useDownloadExport();
  const running = job.status === 'QUEUED' || job.status === 'RUNNING';

  function start() {
    download.mutate(job.id, {
      onSuccess: (link) => {
        // A real navigation to a signed URL rather than an anchor rendered into
        // the row: the link is short-lived and must be fetched at the moment
        // the reader asks, not when the list rendered.
        window.location.assign(link.url);
      },
      onError: (error: Error) => {
        toast.add({ type: 'error', title: 'Could not download', description: error.message });
      },
    });
  }

  return (
    <div className="flex flex-col gap-2 border-b p-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{job.reportLabel}</span>
          <StatusBadge status={job.status} />
          <span className="text-muted-foreground text-xs">{job.format}</span>
        </div>
        <p className="text-muted-foreground truncate text-xs tabular-nums">
          {job.filename}
          {job.rowCount === null ? '' : `  ·  ${String(job.rowCount)} rows`}
          {`  ·  ${formatTimestamp(job.requestedAt)}`}
        </p>

        {running ? (
          <Progress value={job.progress} className="mt-2 max-w-xs">
            <ProgressLabel>{EXPORT_STATUS_LABELS[job.status]}</ProgressLabel>
            <ProgressValue />
          </Progress>
        ) : null}

        {job.status === 'FAILED' && job.error !== null ? (
          <p className="text-destructive mt-1 text-xs">{job.error}</p>
        ) : null}

        {job.status === 'DONE' ? (
          <p className="text-muted-foreground mt-1 text-xs">
            {job.downloadable
              ? describeExpiry(job.expiresAt)
              : 'This file has passed its seven-day retention and has been deleted.'}
          </p>
        ) : null}
      </div>

      <div className="shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 sm:w-auto"
          disabled={!job.downloadable || download.isPending}
          onClick={start}
        >
          <DownloadSimpleIcon data-icon="inline-start" />
          Download
        </Button>
      </div>
    </div>
  );
}

export function DownloadsPage() {
  const canExport = usePermission(PERMISSIONS.REPORT_EXPORT);
  const jobs = useExportJobs(canExport);

  if (!canExport) {
    return (
      <>
        <PageHeader description="Files produced by an export land here." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TrayIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot export reports</EmptyTitle>
            <EmptyDescription>
              This tray shows files you asked for. Producing one needs the report export
              permission, which an administrator grants.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader description="Files you asked for. Each is kept for seven days, then deleted." />

      <div className="flex flex-col gap-4">
        {jobs.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading downloads" className="border">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} aria-hidden className="flex items-center gap-4 border-b p-3 last:border-b-0">
                <div className="flex-1">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="mt-2 h-3 w-64" />
                </div>
                <Skeleton className="h-8 w-24 shrink-0" />
              </div>
            ))}
          </div>
        ) : null}

        {jobs.isError ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>The downloads could not be loaded</AlertTitle>
            <AlertDescription>
              {jobs.error.message}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  void jobs.refetch();
                }}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {jobs.isSuccess && jobs.data.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TrayIcon />
              </EmptyMedia>
              <EmptyTitle>No downloads yet</EmptyTitle>
              <EmptyDescription>
                Export a report and the file appears here while it is being prepared.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {/* nativeButton={false} because the rendered element is an
                  anchor. Base UI warns otherwise, and it is right to: a
                  link claiming button semantics breaks keyboard and
                  screen-reader behaviour. */}
              <Button size="sm" nativeButton={false} render={<Link to="/reports">Go to reports</Link>} />
            </EmptyContent>
          </Empty>
        ) : null}

        {jobs.isSuccess && jobs.data.length > 0 ? (
          <div className="border">
            {jobs.data.map((job) => (
              <ExportRow key={job.id} job={job} />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
