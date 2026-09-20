"use client";

import { useState, useEffect, useCallback } from "react";
import type { DownloadJob } from "@/lib/types";

interface UseJobReturn {
  job: DownloadJob | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useJob(id: string | null, autoRefresh = true, refreshInterval = 1000): UseJobReturn {
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJob = useCallback(async () => {
    if (!id) {
      setJob(null);
      setIsLoading(false);
      return;
    }
    try {
      setError(null);
      const res = await fetch(`/api/downloads/${id}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to fetch job");
      }

      setJob(data.data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchJob();
  }, [fetchJob]);

  useEffect(() => {
    if (!autoRefresh || !id) return;
    const interval = setInterval(fetchJob, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, id, fetchJob]);

  const cancel = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/downloads/${id}/cancel`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Failed to cancel");
    setJob(data.data.job);
  }, [id]);

  const retry = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/downloads/${id}/retry`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Failed to retry");
    setJob(data.data.job);
  }, [id]);

  const remove = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/downloads/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Failed to delete");
    setJob(null);
  }, [id]);

  return { job, isLoading, error, refresh: fetchJob, cancel, retry, remove };
}