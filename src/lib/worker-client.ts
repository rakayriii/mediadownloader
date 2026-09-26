import { workerSharedSecret, workerUrl } from "@/lib/config";
import { AppError, errorMessage, type ErrorCode } from "@/lib/errors";
import type { JobType } from "@/lib/types";

/**
 * Authorized HTTP client for the remote download worker (worker/server.ts).
 *
 * Security contract:
 *  - Only structured job data is ever sent (never free-form commands).
 *  - Every request carries the shared secret as a Bearer token; the worker
 *    rejects anything else.
 *  - Failures map to AppErrors with the real message preserved (nothing is
 *    hidden behind a generic placeholder).
 */

export interface WorkerJobPayload {
  jobId: string;
  url: string;
  type: JobType;
  formatId?: string;
  audioFormat?: string;
  audioQuality?: string;
  title?: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
  ext?: string;
  batchId?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

/** True when the API has the env needed to talk to a worker. */
export function workerConfigured(): boolean {
  return Boolean(workerSharedSecret() && workerUrl());
}

function workerError(status: number, body: unknown): AppError {
  // The worker responds with a structured error when it is reachable but the
  // job/analyze failed. Surface its real message + code, never a generic
  // wrapper. The "not reachable" phrasing is reserved for connect failures.
  if (typeof body === "object" && body !== null && "error" in body) {
    const e = (body as { error?: { code?: unknown; message?: unknown } }).error;
    if (e && typeof e.code === "string" && typeof e.message === "string") {
      const code = e.code in errorMessage ? (e.code as ErrorCode) : "INTERNAL";
      return new AppError(code, e.message);
    }
    const rawMessage = (body as { error?: unknown }).error;
    if (typeof rawMessage === "string") {
      return new AppError("INTERNAL", rawMessage);
    }
  }
  return new AppError(
    "INTERNAL",
    `Download worker responded with HTTP ${status}; start it with: npm run worker`
  );
}

async function request(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; data: unknown }> {
  const secret = workerSharedSecret();
  if (!secret) {
    throw new AppError(
      "INTERNAL",
      "Worker is not configured (WORKER_SHARED_SECRET is empty). Set it in both the API and worker environments."
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${workerUrl()}${path}`, {
        method: init.method ?? "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch {
      throw new AppError(
        "INTERNAL",
        `Download worker is not reachable at ${workerUrl()}. Start it with: npm run worker`
      );
    }

    const text = await res.text().catch(() => "");
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) throw workerError(res.status, data);
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export const workerClient = {
  /** Ask the worker to run an existing job row (jobId, url, format, …). */
  async submit(payload: WorkerJobPayload): Promise<void> {
    await request("/v1/jobs", { body: payload });
  },

  /** Ask the worker to abort + cancel a job it owns. */
  async cancel(jobId: string): Promise<void> {
    await request("/v1/cancel", { body: { jobId } });
  },

  /** Analyze a URL on the worker (same fixed analyzeMedia workflow). */
  async analyze(rawUrl: string): Promise<unknown> {
    const { data } = await request("/v1/analyze", { body: { url: rawUrl } });
    const media = (data as { media?: unknown }).media;
    if (!media) {
      throw new AppError("INTERNAL", "Worker returned no media data");
    }
    return media;
  },

  async health(): Promise<{
    ok: boolean;
    kind: "worker";
    message?: string;
    ytdlp?: string;
    ffmpeg?: string;
  }> {
    try {
      const { data } = await request("/v1/health", { method: "GET" });
      const h = data as {
        ok?: boolean;
        ytdlp?: string;
        ffmpeg?: string;
        message?: string;
      };
      return {
        ok: Boolean(h.ok),
        kind: "worker",
        ytdlp: h.ytdlp,
        ffmpeg: h.ffmpeg,
        message: h.message,
      };
    } catch (err) {
      return {
        ok: false,
        kind: "worker",
        message: err instanceof AppError ? err.message : "Worker health check failed",
      };
    }
  },
};