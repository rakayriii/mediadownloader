import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Central runtime configuration for MediaVault.
 * All paths root from the project's data directory so the app stays
 * self-contained (no writes outside the repo).
 */

function projectRoot(): string {
  return resolve(process.cwd());
}

export const DATA_DIR = process.env.MEDIAVAULT_DATA_DIR
  ? resolve(process.env.MEDIAVAULT_DATA_DIR)
  : join(projectRoot(), ".mediavault");

export const DATABASE_PATH = join(DATA_DIR, "mediavault.db");

export const DOWNLOADS_DIR =
  process.env.MEDIAVAULT_DOWNLOADS_DIR ?? join(DATA_DIR, "downloads");

export const TEMP_DIR = join(DATA_DIR, "temp");

export const THUMBNAIL_DIR = join(DATA_DIR, "thumbnails");

/** Download timeout (ms). Downloads can be large; keep generous. */
export const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.MEDIAVAULT_DOWNLOAD_TIMEOUT_MS ?? 30 * 60 * 1000
);

/** Analysis timeout (ms). */
export const ANALYZE_TIMEOUT_MS = Number(
  process.env.MEDIAVAULT_ANALYZE_TIMEOUT_MS ?? 60 * 1000
);

/** Validation timeout (ms) — DNS + header probe. */
export const VALIDATE_TIMEOUT_MS = Number(
  process.env.MEDIAVAULT_VALIDATE_TIMEOUT_MS ?? 20 * 1000
);

/** URL length cap for user-supplied URLs. */
export const MAX_URL_LENGTH = 2048;

/** Maximum URLs per batch job. */
export const MAX_BATCH_SIZE = 50;

/** Progress is reported at most every N ms per job to avoid flooding the server. */
export const PROGRESS_THROTTLE_MS = 250;

/** Aged files older than this (minutes) are removed by the temp sweeper. */
export const TEMP_FILE_TTL_MINUTES = Number(
  process.env.MEDIAVAULT_TEMP_TTL_MINUTES ?? 60 * 6
);

/** Sweep interval (minutes) for the temp file cleaner. */
export const SWEEP_INTERVAL_MINUTES = Number(
  process.env.MEDIAVAULT_SWEEP_INTERVAL_MINUTES ?? 30
);

/** Default concurrency for background downloads when settings are unavailable. */
export const DEFAULT_CONCURRENCY = 2;

const KNOWN_BINARY_DIRS = [
  process.env.YTDLP_PATH,
  join(homedir(), ".local", "bin", "yt-dlp"),
  "/usr/local/bin/yt-dlp",
  "/opt/homebrew/bin/yt-dlp",
  join(projectRoot(), "vendor", "yt-dlp"),
].filter((p): p is string => Boolean(p));

/** Locate the yt-dlp binary: env override, PATH lookup, then common locations. */
export function resolveYtdlpPath(): string | null {
  const candidates = new Set<string>();

  if (process.env.YTDLP_PATH) candidates.add(process.env.YTDLP_PATH);
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of pathDirs) candidates.add(join(dir, "yt-dlp"));
  for (const dir of KNOWN_BINARY_DIRS) candidates.add(dir);

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // ignore unreadable paths
    }
  }
  return null;
}

/** Locate ffmpeg; falls back to PATH lookup result. */
export function resolveFfmpegPath(): string | null {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, "ffmpeg");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}