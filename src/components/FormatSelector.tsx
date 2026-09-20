"use client";

import { useState, useMemo } from "react";
import { Select, Button, Card, CardContent } from "@/components/ui";
import type { FormatOption, JobType, MediaInfo } from "@/lib/types";
import { Music, Settings, CheckCircle } from "lucide-react";

interface FormatSelectorProps {
  media: MediaInfo | null;
  type: JobType;
  selectedFormatId: string | undefined;
  onFormatChange: (formatId: string) => void;
  onAudioSettingsChange?: (settings: { audioFormat: string; audioQuality: string }) => void;
}

export function FormatSelector({
  media,
  type,
  selectedFormatId,
  onFormatChange,
  onAudioSettingsChange,
}: FormatSelectorProps) {
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [audioQuality, setAudioQuality] = useState("5");

  const formats = useMemo(() => {
    if (!media?.formats) return [];
    return type === "audio"
      ? media.formats.filter((f) => f.group === "audio")
      : media.formats.filter((f) => f.group === "video");
  }, [media, type]);

  const videoQualities = useMemo(() => {
    if (!media?.formats) return [];
    const videoFormats = media.formats.filter((f) => f.group === "video" && f.hasVideo);
    const qualityMap = new Map<number, FormatOption>();
    videoFormats.forEach((f) => {
      if (f.height && (!qualityMap.has(f.height) || (f.isRecommended && !qualityMap.get(f.height)?.isRecommended))) {
        qualityMap.set(f.height, f);
      }
    });
    return Array.from(qualityMap.values()).sort((a, b) => (b.height || 0) - (a.height || 0));
  }, [media]);

  const handleFormatChange = (formatId: string) => {
    onFormatChange(formatId);
  };

  const handleAudioFormatChange = (format: string) => {
    setAudioFormat(format);
    onAudioSettingsChange?.({ audioFormat: format, audioQuality });
  };

  const handleAudioQualityChange = (quality: string) => {
    setAudioQuality(quality);
    onAudioSettingsChange?.({ audioFormat, audioQuality: quality });
  };

  if (!media || formats.length === 0) {
    return (
      <Card className="border-outline-variant">
        <CardContent className="py-8 text-center">
          <p className="text-on-surface-variant">Analyze a URL to see available formats</p>
        </CardContent>
      </Card>
    );
  }

  if (type === "audio") {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Audio Format"
                value={audioFormat}
                onChange={(e) => handleAudioFormatChange(e.target.value)}
                options={[
                  { value: "mp3", label: "MP3" },
                  { value: "m4a", label: "M4A (AAC)" },
                  { value: "opus", label: "OPUS" },
                  { value: "wav", label: "WAV" },
                  { value: "aac", label: "AAC" },
                  { value: "flac", label: "FLAC" },
                  { value: "vorbis", label: "Vorbis" },
                ]}
              />
              <Select
                label="Quality"
                value={audioQuality}
                onChange={(e) => handleAudioQualityChange(e.target.value)}
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
              />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h4 className="text-label-lg text-on-surface">Video Quality</h4>
            <span className="text-body-sm text-on-surface-variant">{videoQualities.length} options</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {videoQualities.map((format) => (
              <Button
                key={format.id}
                type="button"
                variant={selectedFormatId === format.id ? "primary" : "secondary"}
                size="md"
                className="w-full justify-start gap-3 text-left p-3 sm:p-4 min-h-[80px]"
                onClick={() => handleFormatChange(format.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-body-md truncate">{format.label}</span>
                    {format.isRecommended && (
                      <span className="flex items-center gap-1 text-xs text-primary whitespace-nowrap">
                        <CheckCircle className="w-3 h-3" /> Recommended
                      </span>
                    )}
                  </div>
                  {format.note && <p className="mt-1 text-body-sm text-on-surface-variant truncate">{format.note}</p>}
                </div>
                {selectedFormatId === format.id && (
                  <CheckCircle className="w-5 h-5 text-on-primary flex-shrink-0" />
                )}
              </Button>
            ))}
          </div>

          {selectedFormatId && selectedFormatId !== "best" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 w-full sm:w-auto justify-start"
              onClick={() => handleFormatChange("best")}
            >
              <Settings className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Advanced: Select specific format ID ({selectedFormatId})</span>
              <span className="sm:hidden">Advanced: {selectedFormatId}</span>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-outline-variant">
        <CardContent className="pt-0 pb-2">
          <h4 className="text-label-lg text-on-surface mb-3">Audio Only Options</h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {formats
              .filter((f) => f.group === "audio")
              .slice(0, 8)
              .map((format) => (
                <Button
                  key={format.id}
                  type="button"
                  variant={selectedFormatId === format.id ? "primary" : "secondary"}
                  size="sm"
                  className="w-full justify-start gap-2 text-left p-2 sm:p-3 min-h-[56px]"
                  onClick={() => handleFormatChange(format.id)}
                >
                  <Music className="w-4 h-4 flex-shrink-0" />
                  <span className="text-body-sm truncate">{format.label}</span>
                  {selectedFormatId === format.id && <CheckCircle className="w-4 h-4 text-on-primary" />}
                </Button>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}