"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { UrlAnalyzer } from "@/components/UrlAnalyzer";
import { FormatSelector } from "@/components/FormatSelector";
import { DownloadQueue } from "@/components/DownloadQueue";
import { BatchDownload } from "@/components/BatchDownload";
import { SettingsPanel } from "@/components/SettingsPanel";
import type { MediaInfo, JobType } from "@/lib/types";
import { Download, Settings, List, Copy } from "lucide-react";

export const dynamic = "force-dynamic";

export default function Home() {
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [type, setType] = useState<JobType>("video");
  const [selectedFormatId, setSelectedFormatId] = useState<string | undefined>("best");
  const [activeTab, setActiveTab] = useState<"download" | "batch" | "history" | "settings">("download");
  const [showFormatSelector, setShowFormatSelector] = useState(false);

  const handleAnalyze = (result: MediaInfo | null) => {
    if (!result || Object.keys(result).length === 0) {
      setMedia(null);
      setShowFormatSelector(false);
      return;
    }
    setMedia(result);
    setShowFormatSelector(true);
    setSelectedFormatId("best");
  };

  const handleDownload = async () => {
    if (!media) return;

    try {
      const res = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: media.webpageUrl || media.url,
          type,
          formatId: selectedFormatId,
          // Pass the metadata we already fetched so the job does not
          // re-run the slow yt-dlp metadata extraction again.
          title: media.title,
          uploader: media.uploader,
          thumbnail: media.thumbnail,
          duration: media.duration,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to start download");
      }

      alert("Download started! Check the Queue tab for progress.");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start download");
    }
  };

  const handleCopyUrl = () => {
    if (media) {
      navigator.clipboard.writeText(media.webpageUrl || media.url);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "download" | "batch" | "history" | "settings")}>
        <header className="border-b border-outline">
          <div className="max-w-6xl mx-auto">
            <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
                  <Download className="w-6 h-6 text-on-primary" />
                </div>
                <h1 className="text-headline-md text-on-surface font-semibold">MediaVault</h1>
              </div>
              <TabsList className="bg-surface-container p-1 rounded-lg w-full sm:w-auto flex flex-wrap justify-center gap-1 sm:gap-0">
                <TabsTrigger value="download" className="px-3 py-2 sm:px-4 text-sm sm:text-base">
                  <Download className="w-4 h-4 mr-1.5 sm:mr-2" />
                  <span className="hidden sm:inline">Download</span>
                </TabsTrigger>
                <TabsTrigger value="batch" className="px-3 py-2 sm:px-4 text-sm sm:text-base">
                  <List className="w-4 h-4 mr-1.5 sm:mr-2" />
                  <span className="hidden sm:inline">Batch</span>
                </TabsTrigger>
                <TabsTrigger value="history" className="px-3 py-2 sm:px-4 text-sm sm:text-base">
                  <List className="w-4 h-4 mr-1.5 sm:mr-2" />
                  <span className="hidden sm:inline">Queue</span>
                </TabsTrigger>
                <TabsTrigger value="settings" className="px-3 py-2 sm:px-4 text-sm sm:text-base">
                  <Settings className="w-4 h-4 mr-1.5 sm:mr-2" />
                  <span className="hidden sm:inline">Settings</span>
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-6xl mx-auto w-full p-4 sm:p-6 md:p-8 lg:p-10 space-y-4 sm:space-y-6">
          <TabsContent value="download">
            <div className="space-y-4 sm:space-y-6">
              <UrlAnalyzer onAnalyze={handleAnalyze} type={type} onTypeChange={setType} />

              {media && showFormatSelector && (
                <div className="space-y-4 sm:space-y-6">
                  <div className="p-3 sm:p-4 bg-surface-container border border-outline rounded-lg">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h2 className="text-headline-sm text-on-surface truncate">{media.title}</h2>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-body-sm text-on-surface-variant">
                          {media.uploader && <span>{media.uploader}</span>}
                          {media.duration && <span>{Math.floor(media.duration / 60)}:{String(media.duration % 60).padStart(2, "0")}</span>}
                          {media.extractor && <span>{media.extractor}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <Button variant="ghost" size="sm" onClick={handleCopyUrl} className="w-full sm:w-auto">
                          <Copy className="w-4 h-4 mr-1" />
                          <span className="hidden sm:inline">Copy URL</span>
                        </Button>
                      </div>
                    </div>
                  </div>

                  <FormatSelector
                    media={media}
                    type={type}
                    selectedFormatId={selectedFormatId}
                    onFormatChange={setSelectedFormatId}
                    onAudioSettingsChange={() => {}}
                  />

                  <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-outline-variant">
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={handleDownload}
                      className="w-full sm:flex-1"
                    >
                      <Download className="w-5 h-5 mr-2" />
                      Start Download
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => {
                        setMedia(null);
                        setShowFormatSelector(false);
                      }}
                      className="w-full sm:w-auto"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="batch">
            <BatchDownload />
          </TabsContent>

          <TabsContent value="history">
            <DownloadQueue />
          </TabsContent>

          <TabsContent value="settings">
            <SettingsPanel />
          </TabsContent>
        </main>

        <footer className="border-t border-outline p-4">
          <div className="max-w-6xl mx-auto text-center text-body-sm text-on-surface-variant">
            MediaVault - Self-hosted media downloader
          </div>
        </footer>
      </Tabs>
    </div>
  );
}