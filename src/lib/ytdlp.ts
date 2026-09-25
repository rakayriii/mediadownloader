import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readdir, rename, stat } from "node:fs/promises";
import { AppError } from "@/lib/errors";
import {
  ANALYZE_TIMEOUT_MS,
  CACHE_DIR,
  DOWNLOAD_TIMEOUT_MS,
  DOWNLOADS_DIR,
  resolveFfmpegPath,
  resolveYtdlpPath,
  TEMP_DIR,
} from "@/lib/config";
import { mapFormats, type YtDump } from "@/lib/formats";
import type { JobProgress, MediaInfo } from "@/lib/types";
import {
  commandFailureToAppError,
  runCommand,
  type RunResult,
} from "@/lib/tools";
import { assertValidUrl } from "@/lib/validation";

/**
 * Thin, safe wrapper around the yt-dlp binary. All external input is passed
 * as argv (never through a shell), and only public media URLs that pass
 * validation are processed.
 */

const PROGRESS_MARKER = "__MVPROG__";
const POSTPROCESS_MARKER = "__MVPP__";

function requireBinary(): string {
  const bin = resolveYtdlpPath();
  if (!bin) {
    throw new AppError(
      "YTDLP_NOT_FOUND",
      "yt-dlp is not installed on this server. Install it (or set YTDLP_PATH) to enable downloads."
    );
  }
  return bin;
}

export function ytdlpVersion(): Promise<string | null> {
  const bin = resolveYtdlpPath();
  if (!bin) return Promise.resolve(null);
  return runCommand(bin, ["--version"], { timeoutMs: 10_000 })
    .then((r) => (r.code === 0 ? r.stdout.trim() : null))
    .catch(() => null);
}

/** Strip characters that are illegal or dangerous in file names. */
export function sanitizeFilename(raw: string, maxLength = 160): string {
  const cleaned = raw
    .replace(/[\/\\:\*\?"<>\|\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = cleaned.length > 0 ? cleaned : "media";
  return fallback.slice(0, maxLength) || "media";
}

interface AnalyzeOptions {
  signal?: AbortSignal;
}

/**
 * Short-TTL in-memory cache for analyze results (keyed by resolved URL).
 * Real results are cached briefly so re-analyzing the same link (common when
 * the user tweaks settings or redownloads) is instant instead of waiting on
 * the media host again. Cache entries are plain objects we already returned,
 * so this never mocks or fabricates metadata.
 */
const ANALYZE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — long enough to cover an active session
/** How long persisted info dumps stay valid for the extraction-skip fast path. */
export const ANALYZE_INFO_TTL_MS = ANALYZE_CACHE_TTL_MS;
const ANALYZE_CACHE_MAX = 100;
const analyzeCache = new Map<
  string,
  { expiresAt: number; media: MediaInfo }
>();

function getCachedAnalyze(url: string): MediaInfo | null {
  const hit = analyzeCache.get(url);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    analyzeCache.delete(url);
    return null;
  }
  return hit.media;
}

function storeAnalyze(url: string, media: MediaInfo): void {
  if (analyzeCache.size >= ANALYZE_CACHE_MAX) {
    const oldest = analyzeCache.keys().next().value;
    if (oldest !== undefined) analyzeCache.delete(oldest);
  }
  analyzeCache.set(url, { expiresAt: Date.now() + ANALYZE_CACHE_TTL_MS, media });
}

/** Canonical URL form used as the cache key (mirrors analyzeMedia). */
async function canonicalUrl(rawUrl: string): Promise<string> {
  return (await assertValidUrl(rawUrl, { resolveDns: false })).toString();
}

/** On-disk path of the raw yt-dlp info dump for a URL. */
export async function infoJsonPathFor(rawUrl: string): Promise<string> {
  const url = await canonicalUrl(rawUrl);
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return join(CACHE_DIR, `${hash}.info.json`);
}

/** Cached analyze hit for a URL (null on miss/expiry). */
export async function getCachedAnalyzeForUrl(
  rawUrl: string
): Promise<MediaInfo | null> {
  return getCachedAnalyze(await canonicalUrl(rawUrl));
}

/** Persist the raw yt-dlp info dump so downloads can skip re-extraction. */
async function writeInfoJsonCache(url: string, dump: YtDump): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 32);
    await writeFile(
      join(CACHE_DIR, `${hash}.info.json`),
      JSON.stringify(dump),
      "utf8"
    );
  } catch (err) {
    console.error("[ytdlp] Failed to write info cache:", err);
  }
}

/** True when a cached info dump exists for this URL and is fresh. */
export function hasFreshInfoJson(path: string, ttlMs: number): boolean {
  try {
    if (!existsSync(path)) return false;
    const { mtime } = statSync(path);
    return Date.now() - mtime.getTime() <= ttlMs;
  } catch {
    return false;
  }
}

/** Fetch full metadata + formats for a single media page. */
export async function analyzeMedia(
  rawUrl: string,
  options: AnalyzeOptions = {}
): Promise<MediaInfo> {
  const bin = requireBinary();
  // Skip DNS resolution for analysis - yt-dlp does its own validation
  const url = (await assertValidUrl(rawUrl, { resolveDns: false })).toString();

  const cached = getCachedAnalyze(url);
  if (cached) return cached;

  const args = [
    "-J",
    "--no-playlist",
    "--skip-download",
    "--no-warnings",
    // Skip per-format URL probing: returns the same format list without
    // spending a HEAD request on every stream URL. Saves ~1s on large lists.
    "--no-check-formats",
    "--socket-timeout",
    "30",
    url,
  ];

  const warnings: string[] = [];
  let result: RunResult;
  try {
    result = await runCommand(bin, args, {
      timeoutMs: ANALYZE_TIMEOUT_MS,
      signal: options.signal,
      onStderrLine: (line) => {
        if (/^ERROR:/i.test(line)) warnings.push(line);
        else if (/^WARNING:/i.test(line)) warnings.push(line);
      },
    });
  } catch (err) {
    throw commandFailureToAppError(err, {
      binary: "yt-dlp",
      notFoundCode: "YTDLP_NOT_FOUND",
    });
  }

  if (result.timedOut) {
    throw new AppError("TIMEOUT", "Media analysis timed out.");
  }
  if (result.code !== 0) {
    const detail = extractYtdlpError(result.stderr) ?? result.stderr.trim();
    throw new AppError("YTDLP_ERROR", detail || "yt-dlp could not analyze this URL");
  }

  let dump: YtDump;
  try {
    dump = JSON.parse(result.stdout) as YtDump;
  } catch {
    const detail = extractYtdlpError(result.stderr);
    throw new AppError(
      "YTDLP_ERROR",
      detail ?? "Unexpected response from the media extractor"
    );
  }

  if (!dump.title || !dump.id) {
    throw new AppError("MEDIA_UNAVAILABLE", "No playable media found at this URL");
  }

  const { formats, qualities } = mapFormats(dump);

  if (formats.length === 0 && !dump.is_live) {
    // Live streams expose no classic formats but can still be played.
    if (!dump.is_live) {
      throw new AppError(
        "MEDIA_UNAVAILABLE",
        "This media has no downloadable formats"
      );
    }
  }

  const media: MediaInfo = {
    url,
    webpageUrl: dump.webpage_url || url,
    id: dump.id,
    title: dump.title,
    description: dump.description,
    duration: dump.duration,
    thumbnail: dump.thumbnail,
    uploader: dump.uploader ?? dump.channel,
    channel: dump.channel,
    uploadDate: dump.upload_date,
    viewCount: dump.view_count,
    likeCount: dump.like_count,
    extractor: dump.extractor ?? "unknown",
    extractorKey: dump.ie_key ?? dump.extractor_key ?? "unknown",
    live: dump.is_live,
    ageLimit: dump.age_limit,
    formats,
    qualities,
  };

  void warnings;
  storeAnalyze(url, media);
  // Persist the raw info dump so an imminent download with this URL can skip
  // yt-dlp's extraction entirely (the player-API round-trip is the slow part).
  if (Array.isArray(dump.formats) && dump.formats.length > 0) {
    void writeInfoJsonCache(url, dump);
  }
  return media;
}

interface DownloadOptions {
  url: string;
  formatId: string;
  /** Per-job directory to stage the download in. */
  workDir: string;
  /** Final directory the completed file is moved to. */
  outputDir?: string;
  extractAudio?: boolean;
  audioFormat?: string;
  audioQuality?: string;
  signal?: AbortSignal;
  onProgress?: (progress: JobProgress) => void;
  timeoutMs?: number;
  /** Progress callback throttle (ms). */
  throttleMs?: number;
  /**
   * Path to a previously saved yt-dlp info dump. When provided, extraction is
   * skipped entirely and yt-dlp downloads straight from the cached streams,
   * eliminating the player-API round-trip before the first byte.
   */
  infoJsonPath?: string;
}

export interface DownloadOutcome {
  /** Absolute path of the completed file. */
  filePath: string;
  fileName: string;
  sizeBytes: number;
  ext: string;
}

function formatSpecFor(formatId: string): string {
  if (formatId === "best") return "bv*+ba/b";
  return formatId;
}

/**
 * Check if a format specifier requires ffmpeg for merging.
 * Formats with '+' (e.g., "137+140") or 'bestaudio'/'bestvideo' require ffmpeg.
 */
function requiresFfmpeg(formatSpec: string): boolean {
  return formatSpec.includes("+") || 
         formatSpec.includes("bestaudio") || 
         formatSpec.includes("bestvideo") ||
         formatSpec === "bv*+ba/b";
}

function resolveProgress(
  onProgress?: (p: JobProgress) => void,
  throttleMs = 200
): {
  onStdoutLine: (line: string) => void;
  setStage: (stage: JobProgress["stage"], message?: string) => void;
} {
  let lastEmit = 0;
  let latest: JobProgress | null = null;

  const emit = () => {
    if (!latest || !onProgress) return;
    onProgress(latest);
  };

  /** Merge, keeping existing fields when the new value is undefined. */
  const push = (p: JobProgress) => {
    latest = {
      ...latest,
      ...Object.fromEntries(
        Object.entries(p).filter(([, v]) => v !== undefined)
      ),
    } as JobProgress;
    const now = Date.now();
    if (now - lastEmit >= throttleMs) {
      lastEmit = now;
      emit();
    }
  };

  const onStdoutLine = (line: string) => {
    if (line.startsWith(PROGRESS_MARKER)) {
      const body = line.slice(PROGRESS_MARKER.length);
      const [status, percent, speed, eta, downloaded, total] = body.split("|");
      const pct = parsePercent(percent);
      // A "downloading" line at 100% means the stream is complete (or yt-dlp
      // capped the estimate) — show it as wrapping up, never as a frozen bar.
      const finished = status === "finished" || pct === 100;
      const parsed: JobProgress = {
        stage: finished ? "finalizing" : "downloading",
        message: finished ? "Finalizing…" : undefined,
        percent: pct,
        speed: cleanField(speed),
        eta: cleanField(eta),
        downloadedBytes: toBytes(downloaded),
        totalBytes: toBytes(total),
      };
      push(parsed);
      return;
    }
    if (line.startsWith(POSTPROCESS_MARKER)) {
      const status = line.slice(POSTPROCESS_MARKER.length);
      if (status === "started") {
        push({ stage: "processing", message: "Processing audio/video…" });
      } else {
        push({ stage: "processing", message: "Post-processing…" });
      }
    }
  };

  return {
    onStdoutLine,
    setStage: (stage, message) => {
      latest = {
        ...latest,
        stage,
        message:
          message ??
          (stage === "downloading"
            ? "Downloading…"
            : stage === "processing"
              ? "Processing audio/video…"
              : "Finalizing…"),
      };
    },
  };
}

function cleanField(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return v.length > 0 && v !== "NA" ? v : undefined;
}

function parsePercent(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim().replace("%", "").replace(" ", "");
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : undefined;
}

function toBytes(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function extractYtdlpError(stderr: string): string | null {
  const lines = stderr.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ERROR:")) {
      return trimmed.replace(/^ERROR:\s*/, "").trim();
    }
  }
  return null;
}

/** Parse a plain "[download] x% of ..." line (fallback for non-template builds). */
function parseDownloadLine(line: string): Partial<JobProgress> | null {
  const m = line.match(/\[download\]\s+([\d.]+)%/);
  if (m) {
    return {
      stage: "downloading",
      percent: Number(m[1]),
    };
  }
  return null;
}

/** Download media (or extract audio) and return the finished file. */
export async function downloadMedia(options: DownloadOptions): Promise<DownloadOutcome> {
  const bin = requireBinary();
  const url = (await assertValidUrl(options.url)).toString();

  await mkdir(options.workDir, { recursive: true });
  await mkdir(options.outputDir ?? DOWNLOADS_DIR, { recursive: true });
  await mkdir(TEMP_DIR, { recursive: true });

  const formatSpec = formatSpecFor(options.formatId);
  
  // Check if ffmpeg is required but not available
  if (requiresFfmpeg(formatSpec)) {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) {
      throw new AppError(
        "FFMPEG_NOT_FOUND",
        "This format requires ffmpeg to merge video and audio streams, but ffmpeg is not installed. " +
        "Please install ffmpeg or select a pre-merged format (single format without '+')."
      );
    }
  }

  const args = [
    "--no-playlist",
    "--newline",
    "--no-warnings",
    "--socket-timeout",
    "30",
    "-f",
    formatSpec,
    "-o",
    join(options.workDir, "%(title).180B [%(id)s].%(ext)s"),
    "--progress-template",
    `download:${PROGRESS_MARKER}%(progress.status)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s`,
    "--progress-template",
    `postprocess:${POSTPROCESS_MARKER}%(postprocess.status)s`,
  ];

  const ffmpegDir = resolveFfmpegPath();
  if (ffmpegDir) {
    args.push("--ffmpeg-location", dirname(ffmpegDir));
  }

  if (options.extractAudio) {
    args.push("-x");
    if (options.audioFormat) args.push("--audio-format", options.audioFormat);
    if (options.audioQuality) args.push("--audio-quality", options.audioQuality);
  }

  // Skip extraction using a previously saved info dump (fast path).
  if (options.infoJsonPath) {
    args.push("--load-info-json", options.infoJsonPath);
  }

  args.push(url);

  const progress = resolveProgress(options.onProgress, options.throttleMs);
  progress.setStage("downloading", "Connecting to source…");

  let result: RunResult;
  try {
    result = await runCommand(bin, args, {
      timeoutMs: options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS,
      signal: options.signal,
      onStdoutLine: (line) => {
        progress.onStdoutLine(line);
        const fallback = parseDownloadLine(line);
        if (fallback && fallback.percent !== undefined) {
          options.onProgress?.({
            stage: "downloading",
            percent: fallback.percent,
            message: "Downloading…",
          });
        }
      },
    });
  } catch (err) {
    if (options.signal?.aborted) {
      throw new AppError("DOWNLOAD_CANCELLED", "Download cancelled");
    }
    throw commandFailureToAppError(err, {
      binary: "yt-dlp",
      notFoundCode: "YTDLP_NOT_FOUND",
    });
  }

  if (result.timedOut) {
    throw new AppError("TIMEOUT", "Download timed out.");
  }
  if (result.code !== 0) {
    if (options.signal?.aborted) {
      throw new AppError("DOWNLOAD_CANCELLED", "Download cancelled");
    }
    const detail = extractYtdlpError(result.stderr) ?? result.stderr.trim();
    throw new AppError("DOWNLOAD_ERROR", detail || "yt-dlp failed to download this media");
  }

  // Locate the finished file inside the work dir.
  const completed = await findCompletedFile(options.workDir, options.audioFormat);
  if (!completed) {
    throw new AppError("DOWNLOAD_ERROR", "Download finished but no output file was found");
  }

  const outputDir = options.outputDir ?? DOWNLOADS_DIR;
  await mkdir(outputDir, { recursive: true });
  const finalPath = join(outputDir, completed.base);
  if (finalPath !== completed.absolute) {
    await rename(completed.absolute, finalPath);
  }

  const size = await stat(finalPath).then((s) => s.size).catch(() => 0);

  return {
    filePath: finalPath,
    fileName: completed.base,
    sizeBytes: size,
    ext: completed.ext,
  };
}

interface CompletedFile {
  absolute: string;
  base: string;
  ext: string;
}

async function findCompletedFile(
  dir: string,
  preferredExt?: string
): Promise<CompletedFile | null> {
  const entries = await readdir(dir);
  const files: Array<{ absolute: string; mtime: number; size: number }> = [];

  for (const entry of entries) {
    if (entry.endsWith(".part") || entry.endsWith(".ytdl") || entry.endsWith(".json")) {
      continue;
    }
    const absolute = join(dir, entry);
    try {
      const s = await stat(absolute);
      if (s.isFile()) {
        files.push({ absolute, mtime: s.mtimeMs, size: s.size });
      }
    } catch {
      // ignore transient files
    }
  }

  if (files.length === 0) return null;

  if (preferredExt) {
    const match = files
      .filter((f) => f.absolute.toLowerCase().endsWith(`.${preferredExt.toLowerCase()}`))
      .sort((a, b) => b.size - a.size)[0];
    if (match) return toCompletedFile(match.absolute);
  }

  // Prefer the largest finished file (merged/processed output wins).
  const largest = [...files].sort((a, b) => b.size - a.size)[0];
  return toCompletedFile(largest.absolute);
}

function toCompletedFile(absolute: string): CompletedFile {
  const base = basename(absolute);
  const dot = base.lastIndexOf(".");
  return {
    absolute,
    base,
    ext: dot > 0 ? base.slice(dot + 1).toLowerCase() : "",
  };
}