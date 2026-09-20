"use client";

import { useState, useEffect, useCallback } from "react";
import type { AppSettings } from "@/lib/types";

interface UseSettingsReturn {
  settings: AppSettings | null;
  isLoading: boolean;
  error: string | null;
  saveSettings: (settings: Partial<AppSettings>) => Promise<void>;
  refresh: () => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  downloadPath: "",
  defaultFormat: "best",
  concurrency: 2,
  keepHistory: true,
  audioFormat: "mp3",
  audioQuality: "5",
  ytdlpPath: "",
};

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/settings");
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to fetch settings");
      }

      setSettings(data.data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSettings();
  }, [fetchSettings]);

  const saveSettings = useCallback(async (newSettings: Partial<AppSettings>) => {
    try {
      setError(null);
      const currentSettings = settings || DEFAULT_SETTINGS;
      const merged = { ...currentSettings, ...newSettings };

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to save settings");
      }

      setSettings(data.data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      throw err;
    }
  }, [settings]);

  return { settings, isLoading, error, saveSettings, refresh: fetchSettings };
}