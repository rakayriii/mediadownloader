"use client";

import { useState } from "react";
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { useBatch } from "@/hooks/useBatch";
import { useDownloads } from "@/hooks/useDownloads";
import type { BatchJob } from "@/lib/types";
import { Plus, Minus, Loader2, X, FileText, Download, CheckCircle, AlertCircle } from "lucide-react";

export function BatchDownload() {
  const [urls, setUrls] = useState<string[]>([""]);
  const [showResults, setShowResults] = useState(false);
  const [batch, setBatch] = useState<BatchJob | null>(null);
  const { createBatch, isLoading, error } = useBatch();

  const { jobs, refresh } = useDownloads({ autoRefresh: true, refreshInterval: 2000 });

  const handleUrlChange = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  const addUrl = () => {
    setUrls([...urls, ""]);
  };

  const removeUrl = (index: number) => {
    if (urls.length <= 1) return;
    const newUrls = urls.filter((_, i) => i !== index);
    setUrls(newUrls);
  };

  const validUrls = urls.filter((u) => u.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validUrls.length === 0 || isLoading) return;

    const result = await createBatch({ urls: validUrls });
    if (result) {
      setBatch(result.batch);
      setShowResults(true);
      setUrls([""]);
      refresh();
    }
  };

  const getStatusConfig = (status: BatchJob["status"]) => {
    switch (status) {
      case "completed": return { label: "Completed", variant: "success" as const };
      case "partial": return { label: "Partial", variant: "warning" as const };
      case "failed": return { label: "Failed", variant: "error" as const };
      case "running": return { label: "Running", variant: "info" as const };
      case "queued": return { label: "Queued", variant: "default" as const };
      case "cancelled": return { label: "Cancelled", variant: "default" as const };
      default: return { label: status, variant: "default" as const };
    }
  };

  const getItemStatusConfig = (status: string) => {
    switch (status) {
      case "completed": return { label: "Done", variant: "success" as const, icon: CheckCircle };
      case "failed": return { label: "Failed", variant: "error" as const, icon: AlertCircle };
      case "running": return { label: "Downloading", variant: "info" as const, icon: Loader2 };
      case "queued": return { label: "Queued", variant: "default" as const, icon: FileText };
      case "cancelled": return { label: "Cancelled", variant: "default" as const, icon: X };
      default: return { label: status, variant: "default" as const, icon: FileText };
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Batch Download
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-body-md text-on-surface-variant">
              Add multiple URLs to download them sequentially. Each URL will be processed as a separate job.
            </p>

            <div className="space-y-3">
              {urls.map((url, index) => (
                <div key={index} className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      type="url"
                      placeholder={`URL ${index + 1}`}
                      value={url}
                      onChange={(e) => handleUrlChange(index, e.target.value)}
                      leftIcon={<Download className="w-5 h-5" />}
                      disabled={isLoading}
                    />
                  </div>
                  {urls.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeUrl(index)}
                      disabled={isLoading}
                      aria-label="Remove URL"
                      className="w-full sm:w-auto mt-2 sm:mt-0"
                    >
                      <Minus className="w-4 h-4" />
                      <span className="hidden sm:inline ml-1">Remove</span>
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <Button type="button" variant="ghost" size="sm" onClick={addUrl} disabled={isLoading} className="w-full sm:w-auto justify-center">
              <Plus className="w-4 h-4 mr-1" />
              Add another URL
            </Button>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-outline-variant">
              <span className="text-body-sm text-on-surface-variant text-center sm:text-left">
                {validUrls.length} valid URL{validUrls.length !== 1 ? "s" : ""} ready
              </span>
              <Button type="submit" variant="primary" size="lg" loading={isLoading} disabled={validUrls.length === 0 || isLoading} className="w-full sm:w-auto">
                <Download className="w-5 h-5 mr-2" />
                Start Batch Download
              </Button>
            </div>

            {error && (
              <div className="p-3 bg-error/10 border border-error/30 rounded-md text-error text-body-sm">
                {error}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {showResults && batch && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-headline-sm">Batch Status</CardTitle>
                <Badge variant={getStatusConfig(batch.status).variant}>{getStatusConfig(batch.status).label}</Badge>
              </div>
              <div className="text-body-sm text-on-surface-variant text-center sm:text-right w-full sm:w-auto">
                {batch.counts.completed}/{batch.counts.total} completed
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {batch.items.map((item) => {
                const config = getItemStatusConfig(item.status);
                const Icon = config.icon;
                const job = jobs.find((j) => j.id === item.jobId);
                const progress = job?.progress;

                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-surface-container rounded-lg border border-outline-variant"
                  >
                    <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0">
                      <Icon className={`w-4 h-4 ${config.variant === "success" ? "text-success" : config.variant === "error" ? "text-error" : config.variant === "info" ? "text-primary" : "text-on-surface-variant"}`} />
                    </div>
                    <div className="flex-1 min-w-0 w-full">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <span className="text-body-sm text-on-surface truncate">{item.url}</span>
                        <Badge variant={config.variant} size="sm" className="w-full sm:w-auto">{config.label}</Badge>
                      </div>
                      {progress && progress.stage === "downloading" && progress.percent !== undefined && (
                        <div className="mt-2 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {job?.fileName && (
                      <span className="text-body-sm text-on-surface-variant truncate w-full sm:max-w-[200px] sm:w-auto">{job.fileName}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}