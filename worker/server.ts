/**
 * MediaVault remote download worker. HTTP server.
 *
 * Runs the SAME fixed yt-dlp/ffmpeg workflow as the app (src/lib/ytdlp.ts +
 * src/lib/jobs.ts) against the SHARED PostgreSQL, so jobs created by the
 * Next.js API can be executed from a residential IP (sources that block
 * Vercel's datacenter IPs work again).
 *
 * Security:
 *  - Every endpoint requires `Authorization: Bearer <WORKER_SHARED_SECRET>`
 *    (constant-time comparison). The server refuses to start without it.
 *  - Only structured job data is accepted, never arbitrary commands.
 *  - No secrets, cookies, headers, or env are ever returned to callers.
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { jobManager } from "../src/lib/jobs";
import { analyzeMedia, ytdlpVersion } from "../src/lib/ytdlp";
import { resolveFfmpegPath } from "../src/lib/config";
import { assertValidUrl } from "../src/lib/validation";
import { AppError } from "../src/lib/errors";
import type { JobType } from "../src/lib/types";

const SECRET = process.env.WORKER_SHARED_SECRET?.trim() ?? "";
if (!SECRET) {
  console.error(
    "[worker] WORKER_SHARED_SECRET is required; refusing to start (security)."
  );
  process.exit(1);
}

const HOST = process.env.WORKER_HOST || "127.0.0.1";
const PORT = Number(process.env.WORKER_PORT ?? 8787);

const MAX_BODY_BYTES = 256 * 1024;
const VALID_AUDIO_FORMATS = [
  "mp3",
  "m4a",
  "opus",
  "wav",
  "aac",
  "flac",
  "vorbis",
];

interface WorkerJobRequest {
  jobId?: unknown;
  url?: unknown;
  type?: unknown;
  formatId?: unknown;
  audioFormat?: unknown;
  audioQuality?: unknown;
  title?: unknown;
  uploader?: unknown;
  thumbnail?: unknown;
  duration?: unknown;
  ext?: unknown;
  batchId?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function authOk(providedToken: string): boolean {
  const expected = Buffer.from(SECRET, "utf8");
  const provided = Buffer.from(providedToken, "utf8");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AppError("INVALID_INPUT", "Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseJson<T>(req: IncomingMessage): Promise<T> {
  const text = await readBody(req);
  if (!text.trim()) {
    throw new AppError("INVALID_INPUT", "Request body must be valid JSON");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("INVALID_INPUT", "Request body must be valid JSON");
  }
}

function send(
  res: ServerResponse,
  status: number,
  payload: unknown
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof AppError) {
    send(res, err.status, { error: { code: err.code, message: err.message } });
    return;
  }
  const message = err instanceof Error ? err.message : "Unexpected worker error";
  send(res, 500, { error: { code: "INTERNAL", message } });
}

function validateJobRequest(body: WorkerJobRequest): {
  jobId: string;
  url: string;
  type: JobType;
  formatId?: string;
  title?: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
  batchId?: string;
  ext?: string;
} {
  const jobId = str(body.jobId);
  if (!jobId || !/^[A-Za-z0-9-]{1,128}$/.test(jobId)) {
    throw new AppError("INVALID_INPUT", "jobId must be a job identifier");
  }
  const url = str(body.url);
  if (!url) throw new AppError("INVALID_INPUT", "url is required");
  const type: JobType = body.type === "audio" ? "audio" : "video";
  const formatId = str(body.formatId);
  if (formatId && !/^[\w\s.,+\-_\[\]]{1,64}$/.test(formatId)) {
    throw new AppError("INVALID_FORMAT", "formatId contains invalid characters");
  }
  if (body.type !== undefined && body.type !== "video" && body.type !== "audio") {
    throw new AppError("INVALID_INPUT", "type must be 'video' or 'audio'");
  }
  const audioFormat = str(body.audioFormat);
  if (audioFormat && !VALID_AUDIO_FORMATS.includes(audioFormat)) {
    throw new AppError("INVALID_INPUT", "Invalid audioFormat");
  }
  const audioQuality = str(body.audioQuality);
  if (
    audioQuality &&
    (!/^\d{1,2}$/.test(audioQuality) ||
      Number(audioQuality) < 0 ||
      Number(audioQuality) > 9)
  ) {
    throw new AppError("INVALID_INPUT", "audioQuality must be between 0 and 9");
  }
  if (body.duration !== undefined && typeof body.duration !== "number") {
    throw new AppError("INVALID_INPUT", "duration must be a number");
  }
  const title = str(body.title);
  if (title && title.length > 500) {
    throw new AppError("INVALID_INPUT", "title is too long");
  }
  const uploader = str(body.uploader);
  if (uploader && uploader.length > 200) {
    throw new AppError("INVALID_INPUT", "uploader is too long");
  }
  const thumbnail = str(body.thumbnail);
  if (thumbnail && thumbnail.length > 1000) {
    throw new AppError("INVALID_INPUT", "thumbnail is too long");
  }
  const batchId = str(body.batchId);
  const ext = str(body.ext);
  if (ext && ext.length > 20) {
    throw new AppError("INVALID_INPUT", "ext is too long");
  }
  return {
    jobId,
    url,
    type,
    formatId,
    title,
    uploader,
    thumbnail,
    duration: typeof body.duration === "number" ? body.duration : undefined,
    batchId,
    ext,
  };
}

async function handleJobs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJson<WorkerJobRequest>(req);
  // Full URL validation (identical to the API); DNS resolution is skipped the
  // same way analyzeMedia does it; yt-dlp performs its own resolution.
  const validated = validateJobRequest(body);
  await assertValidUrl(validated.url, { resolveDns: false });

  const job = await jobManager.runExisting(validated.jobId);
  if (!job) {
    send(res, 404, {
      error: { code: "NOT_FOUND", message: "Download job not found" },
    });
    return;
  }
  if (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled"
  ) {
    send(res, 409, {
      error: {
        code: "INVALID_INPUT",
        message: `Job is already ${job.status}`,
      },
    });
    return;
  }
  send(res, 202, { data: { job } });
}

async function handleCancel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJson<{ jobId?: unknown }>(req);
  const jobId = str(body.jobId);
  if (!jobId || !/^[A-Za-z0-9-]{1,128}$/.test(jobId)) {
    throw new AppError("INVALID_INPUT", "jobId must be a job identifier");
  }
  const job = await jobManager.cancel(jobId);
  if (!job) {
    send(res, 404, {
      error: { code: "NOT_FOUND", message: "Download job not found" },
    });
    return;
  }
  send(res, 200, { data: { job } });
}

async function handleAnalyze(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJson<{ url?: unknown }>(req);
  const url = str(body.url);
  if (!url) throw new AppError("INVALID_INPUT", "url is required");
  const media = await analyzeMedia(url);
  send(res, 200, { data: { media } });
}

async function handleHealth(res: ServerResponse): Promise<void> {
  const version = await ytdlpVersion();
  send(res, 200, {
    data: {
      ok: true,
      service: "mediavault-worker",
      ytdlp: version,
      ffmpeg: resolveFfmpegPath(),
      activeJobs: jobManager.activeCount,
    },
  });
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!authOk(token)) {
    send(res, 401, {
      error: { code: "UNAUTHORIZED", message: "Invalid worker token" },
    });
    return;
  }

  let pathname = "/";
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    send(res, 400, {
      error: { code: "INVALID_INPUT", message: "Invalid request path" },
    });
    return;
  }

  const route = async () => {
    if (req.method === "GET" && pathname === "/v1/health") {
      await handleHealth(res);
      return;
    }
    if (req.method === "POST" && pathname === "/v1/jobs") {
      await handleJobs(req, res);
      return;
    }
    if (req.method === "POST" && pathname === "/v1/cancel") {
      await handleCancel(req, res);
      return;
    }
    if (req.method === "POST" && pathname === "/v1/analyze") {
      await handleAnalyze(req, res);
      return;
    }
    send(res, 404, {
      error: { code: "NOT_FOUND", message: "Unknown worker endpoint" },
    });
  };

  route().catch((err) => sendError(res, err));
}

export function main(): void {
  const server = createServer(handle);
  server.listen(PORT, HOST, () => {
    console.log(`[worker] MediaVault download worker listening on http://${HOST}:${PORT}`);
    void ytdlpVersion().then((v) =>
      console.log(`[worker] yt-dlp ${v ?? "unknown"} · ffmpeg ${resolveFfmpegPath() ?? "not found"}`)
    );
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`[worker] ${sig}: shutting down`);
      try {
        server.close();
      } catch {
        // already closed
      }
      process.exit(0);
    });
  }
}