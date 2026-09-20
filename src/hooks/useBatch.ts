"use client";

import { useState, useCallback } from "react";
import type { BatchJob } from "@/lib/types";

interface CreateBatchResult {
  batch: BatchJob | null;
  invalidCount: number;
}

interface UseBatchReturn {
  batch: BatchJob | null;
  isLoading: boolean;
  error: string | null;
  createBatch: (options: { urls: string[] }) => Promise<CreateBatchResult | null>;
}

export function useBatch(): UseBatchReturn {
  const [batch, setBatch] = useState<BatchJob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createBatch = useCallback(async (options: { urls: string[] }): Promise<CreateBatchResult | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to create batch");
      }

      setBatch(data.data.batch);
      return { batch: data.data.batch, invalidCount: data.data.invalidCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { batch, isLoading, error, createBatch };
}