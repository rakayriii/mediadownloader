"use client";

import { useState, useEffect, useCallback } from "react";
import type { DownloadJob, JobStatus } from "@/lib/types";

interface UseDownloadsOptions {
  search?: string;
  status?: JobStatus | "";
  page?: number;
  pageSize?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseDownloadsReturn {
  jobs: DownloadJob[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSearch: (search: string) => void;
  setStatus: (status: JobStatus | "") => void;
}

export function useDownloads(options: UseDownloadsOptions = {}): UseDownloadsReturn {
  const {
    search = "",
    status = "",
    page: initialPage = 1,
    pageSize: initialPageSize = 20,
    autoRefresh = true,
    refreshInterval = 2000,
  } = options;

  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState(search);
  const [statusFilter, setStatusFilter] = useState(status);

  const fetchJobs = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      if (searchTerm) params.set("search", searchTerm);
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/downloads?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to fetch downloads");
      }

      setJobs(data.data.items);
      setTotal(data.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, searchTerm, statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchJobs, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchJobs]);

  return {
    jobs,
    total,
    page,
    pageSize,
    isLoading,
    error,
    refresh: fetchJobs,
    setPage,
    setPageSize,
    setSearch: setSearchTerm,
    setStatus: setStatusFilter,
  };
}