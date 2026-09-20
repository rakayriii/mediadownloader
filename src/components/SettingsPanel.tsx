"use client";

import { useState } from "react";
import { Button, Input, Select, Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui";
import { useSettings } from "@/hooks/useSettings";
import { Save, Loader2, CheckCircle, FolderOpen, Terminal } from "lucide-react";
import type { AppSettings } from "@/lib/types";

const DEFAULT_SETTINGS: AppSettings = {
  downloadPath: "",
  defaultFormat: "best",
  concurrency: 2,
  keepHistory: true,
  audioFormat: "mp3",
  audioQuality: "5",
  ytdlpPath: "",
};

export function SettingsPanel() {
  const { settings, isLoading, error, saveSettings } = useSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localSettings, setLocalSettings] = useState<Partial<AppSettings>>({});

  const handleChange = (key: string, value: string | number | boolean) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveSettings(localSettings);
      setSaved(true);
      setLocalSettings({});
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // Error handled by hook
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-on-surface-variant">Loading settings...</p>
        </CardContent>
      </Card>
    );
  }

  const current = settings || DEFAULT_SETTINGS;

  const downloadPath = localSettings.downloadPath ?? current.downloadPath;
  const defaultFormat = localSettings.defaultFormat ?? current.defaultFormat;
  const concurrency = localSettings.concurrency ?? current.concurrency;
  const keepHistory = localSettings.keepHistory ?? current.keepHistory;
  const audioFormat = localSettings.audioFormat ?? current.audioFormat;
  const audioQuality = localSettings.audioQuality ?? current.audioQuality;
  const ytdlpPath = localSettings.ytdlpPath ?? current.ytdlpPath;

  const hasChanges = Object.keys(localSettings).length > 0;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-full">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                Settings
              </CardTitle>
              <CardDescription>Configure download behavior and defaults</CardDescription>
            </div>
            {hasChanges && (
              <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={isSaving} className="w-full sm:w-auto">
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-6">
          <div className="border-b border-outline-variant pb-6">
            <h3 className="text-label-lg text-on-surface mb-4">Download Location</h3>
            <Input
              label="Download Path"
              value={downloadPath}
              onChange={(e) => handleChange("downloadPath", e.target.value)}
              placeholder="Leave empty for default (.mediavault/downloads)"
              helperText="Directory where completed files are stored. Must be writable by the server."
              leftIcon={<FolderOpen className="w-5 h-5" />}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Default Video Format"
              value={defaultFormat}
              onChange={(e) => handleChange("defaultFormat", e.target.value)}
              options={[
                { value: "best", label: "Best Available" },
                { value: "bv*+ba/b", label: "Best Video + Best Audio" },
                { value: "bv*[height<=1080]+ba/b", label: "1080p Max + Best Audio" },
                { value: "bv*[height<=720]+ba/b", label: "720p Max + Best Audio" },
                { value: "b[ext=mp4]", label: "Best MP4" },
              ]}
              helperText="Format used when 'Best' is selected for video downloads"
            />

            <Select
              label="Concurrency"
              value={String(concurrency)}
              onChange={(e) => handleChange("concurrency", Number(e.target.value))}
              options={[
                { value: "1", label: "1 (Sequential)" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" },
                { value: "5", label: "5" },
              ]}
              helperText="Maximum simultaneous downloads"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Audio Format"
              value={audioFormat}
              onChange={(e) => handleChange("audioFormat", e.target.value)}
              options={[
                { value: "mp3", label: "MP3" },
                { value: "m4a", label: "M4A (AAC)" },
                { value: "opus", label: "OPUS" },
                { value: "wav", label: "WAV" },
                { value: "aac", label: "AAC" },
                { value: "flac", label: "FLAC" },
                { value: "vorbis", label: "Vorbis" },
              ]}
              helperText="Format used when extracting audio"
            />

            <Select
              label="Audio Quality"
              value={audioQuality}
              onChange={(e) => handleChange("audioQuality", e.target.value)}
              options={[
                { value: "0", label: "Best (0)" },
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" },
                { value: "5", label: "Default (5)" },
                { value: "6", label: "6" },
                { value: "7", label: "7" },
                { value: "8", label: "8" },
                { value: "9", label: "Smallest (9)" },
              ]}
              helperText="Quality for audio extraction (0=best, 9=smallest)"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-surface-container rounded-lg border border-outline-variant">
            <div className="min-w-0">
              <p className="text-body-md text-on-surface truncate">Keep Download History</p>
              <p className="text-body-sm text-on-surface-variant">Retain completed downloads in the history list</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={keepHistory}
                onChange={(e) => handleChange("keepHistory", e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          <div className="border-t border-outline-variant pt-6">
            <h3 className="text-label-lg text-on-surface mb-4">Advanced</h3>
            <Input
              label="yt-dlp Path (Optional)"
              value={ytdlpPath}
              onChange={(e) => handleChange("ytdlpPath", e.target.value)}
              placeholder="Auto-detected from PATH"
              helperText="Full path to yt-dlp binary. Leave empty to auto-detect."
              leftIcon={<Terminal className="w-5 h-5" />}
            />
          </div>

          {error && (
            <div className="p-3 bg-error/10 border border-error/30 rounded-md text-error text-body-sm">
              {error}
            </div>
          )}

          {saved && (
            <div className="flex items-center gap-2 text-success text-body-sm">
              <CheckCircle className="w-4 h-4" />
              Settings saved successfully
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}