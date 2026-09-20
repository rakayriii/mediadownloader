"use client";

import { useState } from "react";
import { Button, Badge, Progress, Card, CardContent, Input } from "@/components/ui";
import { useDownloads } from "@/hooks/useDownloads";
import { useJob } from "@/hooks/useJob";
import type { DownloadJob, JobStatus } from "@/lib/types";
import { X, RotateCcw, Trash2, Download, Eye, Loader2, FileVideo, Music, Search, Filter, ChevronDown } from "lucide-react";

const STATUS_CONFIG: Record<JobStatus, { label: string; variant: BadgeProps["variant"] }> = {
  queued: { label: "Queued", variant: "info" },
  running: { label: "Downloading", variant: "default" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  cancelled: { label: "Cancelled", variant: "default" },
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
  size?: "sm" | "md";
  className?: string;
}

export function DownloadQueue() {
  const [search, setSearchState] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "">("");
  const [page, setPageState] = useState(1);
  const pageSize = 20;

  const {
    jobs,
    total,
    isLoading,
    error,
    refresh,
    setSearch,
    setStatus,
  } = useDownloads({ search, status: statusFilter, page, pageSize });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchState(value);
    setSearch(value);
  };

  const handleStatusChange = (value: JobStatus | "") => {
    setStatusFilter(value);
    setStatus(value);
  };

  const handlePageChange = (newPage: number) => {
    setPageState(newPage);
  };

  if (isLoading && jobs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-on-surface-variant">Loading downloads...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-error/30">
        <CardContent className="py-8 text-center">
          <p className="text-error mb-4">Failed to load downloads: {error}</p>
          <Button variant="secondary" onClick={refresh}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 sm:flex sm:items-center sm:justify-between sm:space-y-0">
        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <div className="relative flex-1 min-w-0">
            <Input
              placeholder="Search downloads..."
              value={search}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-4"
              leftIcon={<Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />}
            />
          </div>
          <div className="relative w-full sm:w-auto">
            <Filter className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
            <select
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value as JobStatus | "")}
              className="w-full appearance-none bg-surface-container border border-outline rounded-md pl-10 pr-8 py-2 text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All Status</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
          </div>
        </div>
        <div className="text-body-sm text-on-surface-variant text-center sm:text-right w-full sm:w-auto">
          Showing {jobs.length} of {total} downloads
        </div>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Download className="w-12 h-12 text-on-surface-variant/50 mx-auto mb-4" />
            <h3 className="text-headline-sm text-on-surface mb-2">No downloads yet</h3>
            <p className="text-on-surface-variant">Analyze a URL and start your first download</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <DownloadJobCard
              key={job.id}
              job={job}
              isExpanded={expandedId === job.id}
              onToggle={() => setExpandedId(expandedId === job.id ? null : job.id)}
            />
          ))}
        </div>
      )}

      {total > pageSize && (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 p-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1}
            className="w-full sm:w-auto"
          >
            Previous
          </Button>
          <span className="text-body-md text-on-surface-variant text-center w-full sm:w-auto">
            Page {page} of {Math.ceil(total / pageSize)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= Math.ceil(total / pageSize)}
            className="w-full sm:w-auto"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

interface DownloadJobCardProps {
  job: DownloadJob;
  isExpanded: boolean;
  onToggle: () => void;
}

function DownloadJobCard({ job, isExpanded, onToggle }: DownloadJobCardProps) {
  const { job: liveJob, cancel, retry, remove } = useJob(job.id, job.status === "running" || job.status === "queued");
  const displayJob = liveJob || job;
  const progress = displayJob.progress;

  const getStatusConfig = (status: JobStatus) => STATUS_CONFIG[status] || { label: status, variant: "default" };
  const statusConfig = getStatusConfig(displayJob.status);

  const formatBytes = (bytes?: number | null) => {
    if (!bytes) return "Unknown size";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(i === 0 ? 0 : 1)}${units[i]}`;
  };

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return "Unknown";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleCancel = async () => {
    await cancel();
    onToggle();
  };

  const handleRetry = async () => {
    await retry();
  };

  const handleRemove = async () => {
    if (confirm("Delete this download and its file?")) {
      await remove();
    }
  };

  return (
    <Card hover onClick={onToggle} className="cursor-pointer relative">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-12 h-12 rounded-lg bg-surface-container-high flex items-center justify-center flex-shrink-0">
                  {displayJob.type === "audio" ? (
                    <Music className="w-6 h-6 text-on-surface-variant" />
                  ) : (
                    <FileVideo className="w-6 h-6 text-on-surface-variant" />
                  )}
                </div>
                <div className="min-w-0">
                  <h4 className="text-body-lg text-on-surface truncate font-medium">{displayJob.title || "Unknown Title"}</h4>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-body-sm text-on-surface-variant">
                    {displayJob.uploader && <span>{displayJob.uploader}</span>}
                    {displayJob.duration && <span>{formatDuration(displayJob.duration)}</span>}
                    {displayJob.ext && <span>{displayJob.ext.toUpperCase()}</span>}
                    {displayJob.sizeBytes && <span>{formatBytes(displayJob.sizeBytes)}</span>}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
              <Badge variant={statusConfig.variant} size="sm">
                {statusConfig.label}
              </Badge>
            </div>
          </div>

          {isExpanded && (
            <div className="mt-4 pt-4 border-t border-outline-variant space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
              {progress && progress.stage !== "queued" && (
                <div className="space-y-2">
                  <Progress value={progress.percent || 0} showLabel label={progress.message || progress.stage} />
                  <div className="flex flex-wrap gap-3 text-body-sm text-on-surface-variant">
                    {progress.speed && <span className="whitespace-nowrap">Speed: {progress.speed}</span>}
                    {progress.eta && <span className="whitespace-nowrap">ETA: {progress.eta}</span>}
                    {progress.downloadedBytes && progress.totalBytes && (
                      <span className="whitespace-nowrap">
                        {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {displayJob.error && (
                <div className="p-3 bg-error/10 border border-error/30 rounded-md">
                  <p className="text-error text-body-sm">{displayJob.error}</p>
                  {displayJob.errorCode && (
                    <p className="text-body-xs text-on-surface-variant mt-1">Code: {displayJob.errorCode}</p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {(displayJob.status === "running" || displayJob.status === "queued") && (
                  <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); handleCancel(); }} className="w-full sm:w-auto">
                    <X className="w-4 h-4 mr-1" />
                    <span className="hidden sm:inline">Cancel</span>
                  </Button>
                )}
                {(displayJob.status === "failed" || displayJob.status === "cancelled") && (
                  <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); handleRetry(); }} className="w-full sm:w-auto">
                    <RotateCcw className="w-4 h-4 mr-1" />
                    <span className="hidden sm:inline">Retry</span>
                  </Button>
                )}
                {displayJob.status === "completed" && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/api/downloads/${displayJob.id}/file`, "_blank");
                      }}
                      className="w-full sm:w-auto"
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      <span className="hidden sm:inline">Play</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        const a = document.createElement("a");
                        a.href = `/api/downloads/${displayJob.id}/file?download=1`;
                        a.download = displayJob.fileName || "download";
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                      className="w-full sm:w-auto"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      <span className="hidden sm:inline">Download</span>
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleRemove(); }} className="w-full sm:w-auto">
                  <Trash2 className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Remove</span>
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 sm:gap-4 text-body-xs text-on-surface-variant">
                <span>Created: {new Date(displayJob.createdAt).toLocaleString()}</span>
                {displayJob.startedAt && <span>•</span>}
                {displayJob.startedAt && <span>Started: {new Date(displayJob.startedAt).toLocaleString()}</span>}
                {displayJob.completedAt && <span>•</span>}
                {displayJob.completedAt && <span>Completed: {new Date(displayJob.completedAt).toLocaleString()}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="absolute right-3 top-3 sm:right-4 sm:top-4 text-on-surface-variant/50 hover:text-on-surface transition-colors">
          {isExpanded ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          )}
        </div>
      </div>
    </Card>
  );
}