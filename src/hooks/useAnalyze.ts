"use client";

import { useState, useCallback } from "react";
import type { MediaInfo } from "@/lib/types";

interface AnalyzeResult {
  media: MediaInfo | null;
  isLoading: boolean;
  error: string | null;
  analyze: (url: string) => Promise<MediaInfo | null>;
}

export function useAnalyze(): AnalyzeResult {
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (url: string): Promise<MediaInfo | null> => {
    setIsLoading(true);
    setError(null);
    setMedia(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to analyze URL");
      }

      setMedia(data.data.media);
      return data.data.media;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { media, isLoading, error, analyze };
}