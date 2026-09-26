import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@/lib/errors";
import {
  DOWNLOADS_DIR,
  PROGRESS_THROTTLE_MS,
  resolveYtdlpPath,
  TEMP_DIR,
} from "@/lib/config";
import {
  batchRepository,
  downloadRepository,
  settingsRepository,
} from "@/lib/db";
import {
  ANALYZE_INFO_TTL_MS,
  analyzeMedia,
  downloadMedia,
  getCachedAnalyzeForUrl,
  hasFreshInfoJson,
  infoJsonPathFor,
  sanitizeFilename,
  type DownloadOutcome,
} from "@/lib/ytdlp";
import {
  deleteFromStorage,
  fileStorageKey,
  mirrorToStorage,
  mimeForExt,
} from "@/lib/storage";
import { initialExecutorKind, isHandoffErrorCode } from "@/lib/executors";
import { workerClient, workerConfigured, type WorkerJobPayload } from "@/lib/worker-client";
import type {
  DownloadJob,
  ExecutorKind,
  JobStatus,
  JobType,
  AppSettings,
} from "@/lib/types";

/**
 * Background job orchestrator.
 *
 * Live state (progress) lives in an in-memory registry; persistent state is
 * mirrored to PostgreSQL at every status milestone. Downloads run through a
 * concurrency-bounded queue so batches can't saturate the server.
 */

export interface CreateDownloadInput {
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

export interface JobHandle {
  id: string;
  status: JobStatus;
}

function isTerminalStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export class JobManager {
  private registry = new Map<string, DownloadJob>();
  private abortControllers = new Map<string, AbortController>();
  private queue: Array<() => Promise<void>> = [];
  private active = 0;
  private maxConcurrency = 2;
  /** Job IDs that have been explicitly removed — prevents re-adding from race conditions. */
  private removedJobs = new Set<string>();

  constructor() {
    this.maxConcurrency = this.readConcurrency();
    // Mark queued/running rows from a previously crashed process as failed,
    // otherwise the history fills up with jobs that will never run again.
    void this.reconcileStaleJobs();
  }

  /**
   * The in-memory queue owns live jobs, so anything left in `queued`/`running`
   * in the database belongs to a process that no longer exists. This runs on a
   * single instance; a container deployment that restarts will converge any
   * orphaned rows to `failed` instead of leaving permanent zombies.
   */
  private async reconcileStaleJobs(): Promise<void> {
    try {
      const count = await downloadRepository.failStaleJobs(
        "Server restarted before this job finished. Retry to download again."
      );
      if (count > 0) {
        console.log(`[JobManager] Marked ${count} stale job(s) as failed`);
      }
    } catch (err) {
      console.error("[JobManager] Failed to reconcile stale jobs:", err);
    }
  }

  private readConcurrency(): number {
    try {
      const settings = settingsRepository.getAllSync();
      const n = Number(settings.concurrency);
      return n >= 1 && n <= 10 ? n : 2;
    } catch {
      return 2;
    }
  }

  private settings(): AppSettings {
    return settingsRepository.getAllSync();
  }

  /** Job metadata merging live progress + persisted fields. */
  async get(id: string): Promise<DownloadJob | null> {
    return this.registry.get(id) ?? (await downloadRepository.get(id));
  }

  async list(): Promise<DownloadJob[]> {
    const rows = (await downloadRepository.list({ limit: 200 })).items;
    const seen = new Set(rows.map((r) => r.id));
    const liveOnly = [...this.registry.values()]
      .filter((j) => !seen.has(j.id) && j.status !== "cancelled")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const rowsWithLive = rows.map((row) => {
      const live = this.registry.get(row.id);
      return live ? { ...row, ...live } : row;
    });
    return [...liveOnly, ...rowsWithLive].slice(0, 200);
  }

  /** Number of jobs currently executing in this process (worker health). */
  get activeCount(): number {
    return this.active;
  }

  /** Create and enqueue a download job. Returns once the job is persisted. */
  async create(
    input: CreateDownloadInput,
    opts: { id?: string; executor?: ExecutorKind } = {}
  ): Promise<DownloadJob> {
    const id = opts.id ?? randomUUID();
    const now = new Date().toISOString();
    const executor: ExecutorKind =
      opts.executor ?? initialExecutorKind(this.settings().executionMode);
    const job: DownloadJob = {
      id,
      type: input.type,
      url: input.url,
      title: input.title ?? null,
      uploader: input.uploader ?? null,
      thumbnail: input.thumbnail ?? null,
      duration: input.duration ?? null,
      formatId: input.formatId,
      ext: input.ext ?? null,
      status: "queued",
      executor,
      progress: { stage: "queued", message: "Waiting in queue…" },
      batchId: input.batchId ?? null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };

    this.registry.set(id, job);
    // Worker-owned jobs are ALWAYS persisted: the worker is a separate process
    // that can only see the job through the shared database (keepHistory=false
    // only suppresses new local-only jobs, never worker-routed ones).
    if (executor === "worker" || this.settings().keepHistory) {
      try {
        await downloadRepository.insert(job);
      } catch (err) {
        console.error("[JobManager] Failed to persist new job:", err);
      }
    }

    // Worker routing: persist first, then hand off. The in-memory registry
    // must NOT hold worker-owned jobs. The DB row is authoritative and the
    // worker updates it directly, so stale registry state would hide progress.
    if (executor === "worker") {
      try {
        await workerClient.submit(payloadFromJob(job));
      } catch (err) {
        const appError = toAppError(err);
        await this.markFailed(id, appError.code, appError.message);
        throw appError;
      }
      this.registry.delete(id);
      return job;
    }

    this.enqueue(async () => {
      await this.runJob(id, input);
    });
    return job;
  }

  async cancel(id: string): Promise<DownloadJob | null> {
    const job = this.registry.get(id) ?? (await downloadRepository.get(id));
    if (!job) return null;
    if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") {
      return job;
    }
    const controller = this.abortControllers.get(id);
    controller?.abort();
    this.abortControllers.delete(id);
    if (!this.registry.has(id)) {
      // Job is owned by an external executor (the worker). If the worker was
      // reachable it already marked the row cancelled via its own cancel().
      // Re-read to avoid clobbering a completed/cancelled state; otherwise
      // mark it cancelled here so it can never stay "running" forever.
      const fresh = await downloadRepository.get(id);
      if (
        fresh &&
        (fresh.status === "completed" ||
          fresh.status === "cancelled" ||
          fresh.status === "failed")
      ) {
        return fresh;
      }
      await this.markCancelled(id);
    } else if (job.status === "queued") {
      await this.markCancelled(id);
    }
    return this.get(id);
  }

  /** Reset a failed/cancelled job and re-enqueue it (respecting routing). */
  async retry(id: string): Promise<DownloadJob | null> {
    const job = await this.get(id);
    if (!job) return null;
    if (job.status === "running" || job.status === "queued") return job;

    const executor: ExecutorKind =
      job.executor ?? initialExecutorKind(this.settings().executionMode);
    const reset: DownloadJob = {
      ...job,
      executor,
      status: "queued",
      progress: { stage: "queued", message: "Waiting in queue…" },
      error: null,
      errorCode: null,
      handoffError: null,
      fileName: null,
      sizeBytes: null,
      completedAt: null,
      startedAt: null,
    };
    this.registry.set(id, reset);
    await this.persist(reset);

    if (executor === "worker") {
      try {
        await workerClient.submit(payloadFromJob(reset));
      } catch (err) {
        const appError = toAppError(err);
        await this.markFailed(id, appError.code, appError.message);
        throw appError;
      }
      this.registry.delete(id);
      return reset;
    }

    this.enqueue(async () => {
      await this.runJob(id, buildInputFromJob(reset));
    });
    return reset;
  }

  /** Run a job row that already exists in the database (worker entry point). */
  async runExisting(id: string): Promise<DownloadJob | null> {
    // The DB row is authoritative for jobs owned by an external executor: a
    // resubmit (e.g. retry after the API reset the row) must never be shadowed
    // by a stale terminal in-memory copy from the previous run.
    const dbJob = await downloadRepository.get(id);
    if (!dbJob) return null;
    if (isTerminalStatus(dbJob.status)) return dbJob;
    const live = this.registry.get(id);
    if (live && !isTerminalStatus(live.status)) return live;
    // No live run; drop any stale entry and (re)start from the DB row.
    this.registry.delete(id);
    if (this.removedJobs.has(id)) return dbJob;
    this.enqueue(async () => {
      await this.runJob(id, buildInputFromJob(dbJob));
    });
    return dbJob;
  }

  /** Remove a job from history + registry and delete its output file. */
  async remove(id: string): Promise<void> {
    await this.cancel(id);
    this.removedJobs.add(id);
    const job = await this.get(id);
    if (job?.fileName && job.fileName.length > 0 && !job.batchId) {
      const settings = this.settings();
      const dir = settings.downloadPath
        ? join(settings.downloadPath, "mediavault")
        : DOWNLOADS_DIR;
      const file = join(dir, job.fileName);
      if (existsSync(file)) {
        try {
          void rm(file, { force: true });
        } catch {
          // best-effort
        }
      }
      // Remove the storage mirror too (idempotent; 404 is fine).
      void deleteFromStorage(fileStorageKey(id, job.fileName));
    }
    void this.closeWorkDir(id);
    this.registry.delete(id);
    this.abortControllers.delete(id);
    try {
      const result = await downloadRepository.delete(id);
      if (result.changes === 0) {
        console.warn(`[JobManager] Job ${id} not found in database during delete`);
      }
    } catch (err) {
      console.error(`[JobManager] Failed to delete job ${id} from database:`, err);
      throw err; // Re-throw so API can return error
    }
  }

  /** Best-effort persistence: the in-memory registry stays authoritative, so a
   *  missing row (e.g. keepHistory=false) must never tear down the live job. */
  private async persist(next: DownloadJob): Promise<void> {
    try {
      await downloadRepository.update(next);
    } catch (err) {
      console.error(`[JobManager] Failed to persist status for ${next.id}:`, err);
    }
  }

  private async markStatus(
    id: string,
    status: JobStatus,
    patch: Partial<DownloadJob> = {}
  ): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    const next: DownloadJob = {
      ...current,
      ...patch,
      status,
    };
    if (status === "running" && !next.startedAt) {
      next.startedAt = new Date().toISOString();
    }
    if (status === "completed" || status === "failed" || status === "cancelled") {
      next.completedAt = new Date().toISOString();
      this.registry.set(id, next);
      await this.persist(next);
      void this.closeWorkDir(id);
      await this.signalBatchItem(id, status);
      this.abortControllers.delete(id);
      return;
    }
    this.registry.set(id, next);
    await this.persist(next);
  }

  private async markCancelled(id: string): Promise<void> {
    if (this.removedJobs.has(id)) return;
    const job = await this.get(id);
    if (!job) return;
    const next: DownloadJob = {
      ...job,
      status: "cancelled",
      error: "Download was cancelled",
      errorCode: "DOWNLOAD_CANCELLED",
      completedAt: new Date().toISOString(),
      progress: { stage: "queued", message: "Cancelled" },
    };
    this.registry.set(id, next);
    await this.persist(next);
    await this.signalBatchItem(id, "cancelled");
    this.abortControllers.delete(id);
  }

  private async closeWorkDir(id: string): Promise<void> {
    try {
      await rm(join(TEMP_DIR, id), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  // ---------------------------------------------------------------- queue

  private enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      this.active += 1;
      void task()
        .catch((err) => {
          console.error("[JobManager] Queue task failed:", err);
        })
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  // ------------------------------------------------------------- execution

  private async runJob(
    id: string,
    input: CreateDownloadInput
  ): Promise<void> {
    const job = await this.get(id);
    if (!job || job.status === "cancelled") return;

    const controller = new AbortController();
    this.abortControllers.set(id, controller);

    const settings = this.settings();
    const binaryOverride = settings.ytdlpPath || process.env.YTDLP_PATH;
    if (binaryOverride && !existsSync(binaryOverride)) {
      await this.markFailed(id, "YTDLP_NOT_FOUND", "The configured yt-dlp path does not exist.");
      return;
    }
    if (!binaryOverride && !resolveYtdlpPath()) {
      await this.markFailed(
        id,
        "YTDLP_NOT_FOUND",
        "yt-dlp is not installed on this server. Install it (or set YTDLP_PATH) to enable downloads."
      );
      return;
    }

    // Re-analyze only when the caller didn't pass metadata (batch/audio flows).
    const willAnalyze = !input.title;
    await this.markStatus(id, "running", {
      progress: willAnalyze
        ? { stage: "analyzing", message: "Fetching media metadata…" }
        : { stage: "downloading", message: "Preparing download…" },
      startedAt: new Date().toISOString(),
    });
    let meta = {
      title: input.title,
      uploader: input.uploader,
      thumbnail: input.thumbnail,
      duration: input.duration,
    };
    if (!input.title) {
      try {
        const info = await analyzeMedia(input.url, { signal: controller.signal });
        meta = {
          title: info.title,
          uploader: info.uploader,
          thumbnail: info.thumbnail,
          duration: info.duration,
        };
        await this.markStatus(id, "running", {
          title: info.title,
          uploader: info.uploader,
          thumbnail: info.thumbnail,
          duration: info.duration,
          progress: { stage: "analyzing", message: "Metadata fetched" },
        });
      } catch (err) {
        if (controller.signal.aborted) {
          await this.markCancelled(id);
          return;
        }
        const appError = toAppError(err);
        await this.handleFailed(id, appError.code, appError.message, appError.details);
        return;
      }
    }

    const title = meta.title ?? "media";
    const workDir = join(TEMP_DIR, id);
    const outputDir = settings.downloadPath
      ? join(settings.downloadPath, "mediavault")
      : DOWNLOADS_DIR;
    await mkdir(outputDir, { recursive: true });

    const isAudio = input.type === "audio";
    const formatId =
      input.formatId ?? (isAudio ? "ba/b" : settings.defaultFormat || "best");

    // Fast path: when metadata was already supplied (the UI just analyzed the
    // URL), reuse the persisted yt-dlp info dump to skip extraction — this is
    // what keeps "Preparing download…" near-instant instead of a 6–8s
    // player-API round-trip before the first progress line.
    let infoJson: string | null = null;
    if (!willAnalyze) {
      try {
        const cached = await getCachedAnalyzeForUrl(input.url);
        if (cached && cached.formats.length > 0) {
          const path = await infoJsonPathFor(input.url);
          if (hasFreshInfoJson(path, ANALYZE_INFO_TTL_MS)) infoJson = path;
        }
      } catch {
        infoJson = null; // any hiccup → normal extraction flow
      }
    }

    let outcome: DownloadOutcome | undefined;
    let lastLivePersist = 0;
    const attempts: Array<{ infoJsonPath?: string }> = infoJson
      ? [{ infoJsonPath: infoJson }, {}]
      : [{}];
    let lastError: AppError | null = null;
    for (const attempt of attempts) {
      if (controller.signal.aborted) {
        await this.markCancelled(id);
        return;
      }
      try {
        outcome = await downloadMedia({
          url: input.url,
          formatId,
          workDir,
          outputDir,
          extractAudio: isAudio,
          audioFormat: isAudio ? settings.audioFormat : undefined,
          audioQuality: isAudio ? settings.audioQuality : undefined,
          signal: controller.signal,
          throttleMs: PROGRESS_THROTTLE_MS,
          infoJsonPath: attempt.infoJsonPath,
          onProgress: (progress) => {
            const current = this.registry.get(id);
            if (!current) return;
            if (current.status !== "running") return;
            current.progress = progress;
            // Cross-process visibility: persist a throttled snapshot of live
            // progress so polls served by another process (or a reloaded
            // registry) never look frozen at an old milestone.
            const now = Date.now();
            if (now - lastLivePersist >= 2000) {
              lastLivePersist = now;
              void this.persist({ ...current, progress });
            }
          },
        });
        break;
      } catch (err) {
        if (controller.signal.aborted) {
          await this.markCancelled(id);
          return;
        }
        lastError = toAppError(err);
        // Only the extraction-skip fast path is retried; a genuinely failing
        // download (cached streams may have expired) is fatal after retry.
        if (lastError.code !== "DOWNLOAD_ERROR" || !attempt.infoJsonPath) {
          await this.handleFailed(
            id,
            lastError.code,
            lastError.message,
            lastError.details
          );
          return;
        }
        console.warn(
          `[JobManager] Extraction-skip failed for ${id}, retrying with fresh extraction: ${lastError.message}`
        );
      }
    }

    if (controller.signal.aborted) {
      await this.markCancelled(id);
      return;
    }
    if (!outcome) return;
    if (lastError) {
      await this.handleFailed(id, lastError.code, lastError.message, lastError.details);
      return;
    }

    const fileName = sanitizeFilename(`${title}.${outcome.ext}`);
    // Rename to the sanitized final file name if different AND the target
    // name is not already taken — two downloads of the same video must never
    // overwrite each other (keep the yt-dlp "[id]" disambiguator instead).
    if (fileName !== outcome.fileName) {
      try {
        const fsPromises = await import("node:fs/promises");
        const target = join(outputDir, fileName);
        const taken = await fsPromises
          .stat(target)
          .then(() => true)
          .catch(() => false);
        if (!taken) {
          await fsPromises.rename(
            join(outputDir, outcome.fileName),
            target
          );
          outcome = { ...outcome, fileName };
        }
      } catch {
        // keep the original name if the rename races with the sweeper
      }
    }

    // Mirror the finished file to Supabase Storage (env-gated). Await before
    // marking "completed" so the status means the file is durable, not just on
    // this instance's ephemeral disk. Oversized objects fail here and degrade
    // to disk-only (the API warns instead of failing the download).
    const mirrorOk = await mirrorToStorage(
      join(outputDir, outcome.fileName),
      fileStorageKey(id, outcome.fileName),
      mimeForExt(outcome.ext.toLowerCase())
    );
    if (!mirrorOk) {
      console.warn(
        `[JobManager] File mirror skipped for ${id} (keeping disk-only)`
      );
    }

    await this.markStatus(id, "completed", {
      progress: {
        stage: "finalizing",
        percent: 100,
        message: "Completed",
      },
      title,
      uploader: meta.uploader,
      thumbnail: meta.thumbnail,
      duration: meta.duration,
      ext: outcome.ext,
      fileName: outcome.fileName,
      sizeBytes: outcome.sizeBytes,
      // A handed-off job must not carry its old failure into "completed".
      error: null,
      errorCode: null,
      handoffError: null,
    });
  }

  /**
   * Unified local-failure handler. In AUTO mode a network/extractor failure
   * (the datacenter-IP block case) is handed off to the worker EXACTLY once,
   * never retried blindly, so the job still succeeds when the worker can
   * reach the source. The original error is kept (handoffError) and merged
   * back in if the worker also fails. Everything else fails like today.
   */
  private async handleFailed(
    id: string,
    code: string,
    message: string,
    details?: unknown
  ): Promise<void> {
    const job = await this.get(id);
    if (!job) return;
    if (
      this.settings().executionMode === "auto" &&
      job.executor !== "worker" &&
      workerConfigured() &&
      isHandoffErrorCode(code)
    ) {
      await this.handoffToWorker(id, code, message, details);
      return;
    }
    await this.markFailed(id, code, message, details);
  }

  private async handoffToWorker(
    id: string,
    code: string,
    message: string,
    details?: unknown
  ): Promise<void> {
    if (this.removedJobs.has(id)) return;
    const current = await this.get(id);
    if (!current) return;
    const original =
      details !== undefined
        ? typeof details === "string"
          ? details
          : JSON.stringify(details)
        : message;
    const next: DownloadJob = {
      ...current,
      status: "queued",
      executor: "worker",
      error: null,
      errorCode: null,
      handoffError: current.handoffError ?? original.slice(0, 2000),
      startedAt: null,
      completedAt: null,
      progress: {
        stage: "queued",
        message: "Blocked on this server; handing off to the local worker…",
      },
    };
    this.registry.set(id, next);
    await this.persist(next);
    // Keep the DB row authoritative; the worker owns it from here.
    this.registry.delete(id);
    this.abortControllers.delete(id);
    void this.closeWorkDir(id);
    try {
      await workerClient.submit(payloadFromJob(next));
    } catch (err) {
      const handoffErr = toAppError(err);
      console.error(`[JobManager] Worker handoff failed for ${id}:`, handoffErr.message);
      await this.markFailed(
        id,
        code,
        `${message}; Worker handoff failed: ${handoffErr.message}`
      );
    }
  }

  private async markFailed(
    id: string,
    code: string,
    message: string,
    details?: unknown
  ): Promise<void> {
    if (this.removedJobs.has(id)) return;
    const current = await this.get(id);
    if (!current) return;
    const next: DownloadJob = {
      ...current,
      status: "failed",
      error: message,
      errorCode: (code as DownloadJob["errorCode"]) ?? "DOWNLOAD_ERROR",
      completedAt: new Date().toISOString(),
      progress: { stage: "finalizing", message: "Failed" },
    };
    if (details !== undefined) {
      const detailStr =
        typeof details === "string" ? details : JSON.stringify(details);
      next.error = detailStr.length > 400 ? `${detailStr.slice(0, 400)}…` : detailStr;
    }
    // A job that was handed off to the worker keeps the original server-side
    // error in handoffError. If the worker also fails, surface both attempts in
    // the visible error field so nothing is hidden from the UI.
    if (current.handoffError && next.error !== current.handoffError) {
      next.error = `${next.error}; original server attempt failed: ${current.handoffError}`;
    }
    this.registry.set(id, next);
    await downloadRepository.update(next);
    await this.signalBatchItem(id, "failed");
    this.abortControllers.delete(id);
    void this.closeWorkDir(id);
  }

  // ---------------------------------------------------------------- batches

  private async signalBatchItem(jobId: string, status: JobStatus): Promise<void> {
    const job = await this.get(jobId);
    if (!job?.batchId) return;
    const batch = await batchRepository.get(job.batchId);
    if (!batch) return;

    const item = batch.items.find((i) => i.jobId === jobId);
    if (!item) return;

    const itemStatus =
      status === "completed"
        ? "completed"
        : status === "cancelled"
          ? "cancelled"
          : "failed";
    await batchRepository.updateItem({ id: item.id, status: itemStatus, jobId });
    // Recompute counters from the item rows — the source of truth — so the
    // batch reaches "completed"/"partial" instead of staying "running".
    await batchRepository.recount(job.batchId);
  }
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) return new AppError("INTERNAL", err.message);
  return new AppError("INTERNAL");
}

/** Structured, whitelisted payload for the worker (never free-form commands). */
function payloadFromJob(job: DownloadJob): WorkerJobPayload {
  return {
    jobId: job.id,
    url: job.url,
    type: job.type,
    formatId: job.formatId,
    title: job.title ?? undefined,
    uploader: job.uploader ?? undefined,
    thumbnail: job.thumbnail ?? undefined,
    duration: job.duration ?? undefined,
    ext: job.ext ?? undefined,
    batchId: job.batchId ?? undefined,
  };
}

/** Rebuild run-input from a persisted job row (retry + worker entry). */
function buildInputFromJob(job: DownloadJob): CreateDownloadInput {
  return {
    url: job.url,
    type: job.type,
    formatId: job.formatId,
    title: job.title ?? undefined,
    uploader: job.uploader ?? undefined,
    thumbnail: job.thumbnail ?? undefined,
    duration: job.duration ?? undefined,
    batchId: job.batchId ?? undefined,
  };
}

/** Process-wide singleton so hot reloads share the queue. */
export const jobManager = new JobManager();
