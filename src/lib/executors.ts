import { resolveFfmpegPath, resolveYtdlpPath } from "@/lib/config";
import type { ExecutionMode, ExecutorKind } from "@/lib/types";
import { workerClient } from "@/lib/worker-client";

/**
 * Pluggable download execution backend.
 *
 * MediaVault runs yt-dlp + ffmpeg either in-process (LocalExecutor, the
 * Vercel deployment) or delegates the job to a standalone remote worker
 * (RemoteWorkerExecutor, e.g. a residential machine that can reach sources
 * whose datacenter IPs are blocked). Both execute the SAME fixed workflow
 * from src/lib/ytdlp.ts and write job state to the same PostgreSQL.
 */

/** Error codes that indicate a network/extractor problem worth retrying on
 *  another execution backend. User errors (invalid URL, media unavailable,
 *  format issues) are never handed off. */
const HANDOFF_ERROR_CODES = new Set<string>([
  "YTDLP_ERROR",
  "TIMEOUT",
  "DOWNLOAD_ERROR",
]);

export function isHandoffErrorCode(code?: string | null): boolean {
  return Boolean(code && HANDOFF_ERROR_CODES.has(code));
}

/** Which backend a NEW job should start on for a given mode. */
export function initialExecutorKind(mode: ExecutionMode): ExecutorKind {
  return mode === "worker" ? "worker" : "vercel";
}

export interface ExecutorHealth {
  ok: boolean;
  kind: ExecutorKind;
  message?: string;
  ytdlp?: string;
  ffmpeg?: string;
}

/** Common interface for execution backends (see class docs above). */
export interface DownloadExecutor {
  readonly kind: ExecutorKind;
  health(): Promise<ExecutorHealth>;
}

/** In-process executor: yt-dlp + ffmpeg run inside the Next.js server. */
export class LocalExecutor implements DownloadExecutor {
  readonly kind: ExecutorKind = "vercel";

  async health(): Promise<ExecutorHealth> {
    const ytdlp = resolveYtdlpPath();
    const ffmpeg = resolveFfmpegPath();
    if (!ytdlp || !ffmpeg) {
      return {
        ok: false,
        kind: this.kind,
        message: !ytdlp ? "yt-dlp binary not found" : "ffmpeg binary not found",
      };
    }
    return { ok: true, kind: this.kind, ytdlp, ffmpeg };
  }
}

/** Remote executor: jobs run on the standalone worker via its authorized API. */
export class RemoteWorkerExecutor implements DownloadExecutor {
  readonly kind: ExecutorKind = "worker";

  async health(): Promise<ExecutorHealth> {
    return workerClient.health();
  }
}

/** Resolve the executor implementation for a routing mode. */
export function executorFor(mode: ExecutionMode): DownloadExecutor {
  return mode === "worker" ? new RemoteWorkerExecutor() : new LocalExecutor();
}