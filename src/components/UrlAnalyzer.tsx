"use client";

import { useState, useCallback } from "react";
import { Input, Button } from "@/components/ui";
import { useAnalyze } from "@/hooks/useAnalyze";
import type { MediaInfo, JobType } from "@/lib/types";
import { Loader2, X, Check } from "lucide-react";

interface UrlAnalyzerProps {
  onAnalyze: (media: MediaInfo | null) => void;
  disabled?: boolean;
  type: JobType;
  onTypeChange: (type: JobType) => void;
}

export function UrlAnalyzer({ onAnalyze, disabled = false, type, onTypeChange }: UrlAnalyzerProps) {
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const { isLoading, error, analyze } = useAnalyze();

  const validateUrl = useCallback((value: string): boolean => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setUrlError("Only http and https URLs are supported");
        return false;
      }
      setUrlError(null);
      return true;
    } catch {
      setUrlError("Please enter a valid URL");
      return false;
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!url.trim() || isLoading) return;

      if (!validateUrl(url)) return;

      const result = await analyze(url);
      if (result) {
        onAnalyze(result);
      }
    },
    [url, isLoading, validateUrl, analyze, onAnalyze]
  );

  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setUrl(e.target.value);
      if (urlError) setUrlError(null);
    },
    [urlError]
  );

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-3">
        <div className="relative flex-1">
          <Input
            type="url"
            value={url}
            onChange={handleUrlChange}
            placeholder="Paste a video or audio URL here..."
            error={urlError || error || undefined}
            disabled={disabled || isLoading}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            }
            rightIcon={
              isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : url && !urlError ? (
                <Check className="w-5 h-5 text-success" />
              ) : null
            }
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={isLoading}
            disabled={disabled || !url.trim() || isLoading}
            className="w-full sm:flex-1"
          >
            Analyze
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              setUrl("");
              setUrlError(null);
              onAnalyze(null);
            }}
            disabled={disabled || isLoading}
            aria-label="Clear URL"
            className="w-full sm:w-auto"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
        <span className="text-label-md text-on-surface-variant w-full sm:w-auto text-center sm:text-left">Type:</span>
        <div className="flex gap-2 w-full">
          <Button
            type="button"
            variant={type === "video" ? "primary" : "secondary"}
            size="sm"
            onClick={() => onTypeChange("video")}
            disabled={disabled || isLoading}
            className="flex-1"
          >
            Video
          </Button>
          <Button
            type="button"
            variant={type === "audio" ? "primary" : "secondary"}
            size="sm"
            onClick={() => onTypeChange("audio")}
            disabled={disabled || isLoading}
            className="flex-1"
          >
            Audio Only
          </Button>
        </div>
      </div>
    </form>
  );
}