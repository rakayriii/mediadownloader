import { prisma } from "@/lib/prisma";
import type {
  AppSettings,
  BatchJob,
  BatchStatus,
  BatchItemStatus,
  DownloadJob,
  ExecutionMode,
  JobStatus,
} from "@/lib/types";

/**
 * Persistent storage backed by PostgreSQL via Prisma.
 * Replaces the previous SQLite implementation.
 */

type DownloadRow = {
  id: string;
  type: string;
  url: string;
  title: string | null;
  uploader: string | null;
  thumbnail: string | null;
  duration: number | null;
  formatId: string | null;
  ext: string | null;
  status: string;
  error: string | null;
  errorCode: string | null;
  fileName: string | null;
  sizeBytes: bigint | null;
  batchId: string | null;
  executor: string | null;
  handoffError: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

function rowToDownload(row: DownloadRow): DownloadJob {
  return {
    id: row.id,
    type: row.type as DownloadJob["type"],
    url: row.url,
    title: row.title,
    uploader: row.uploader,
    thumbnail: row.thumbnail,
    duration: row.duration,
    formatId: row.formatId ?? undefined,
    ext: row.ext,
    status: row.status as DownloadJob["status"],
    progress: null,
    error: row.error,
    errorCode: (row.errorCode as DownloadJob["errorCode"]) ?? null,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes ? Number(row.sizeBytes) : null,
    batchId: row.batchId,
    executor: (row.executor as DownloadJob["executor"]) ?? undefined,
    handoffError: row.handoffError,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export interface DownloadFilters {
  search?: string;
  status?: JobStatus | "";
  limit?: number;
  offset?: number;
}

export interface DownloadListResult {
  items: DownloadJob[];
  total: number;
}

export const downloadRepository = {
  async insert(job: DownloadJob): Promise<void> {
    await prisma.download.create({
      data: {
        id: job.id,
        type: job.type,
        url: job.url,
        title: job.title ?? null,
        uploader: job.uploader ?? null,
        thumbnail: job.thumbnail ?? null,
        duration: job.duration ?? null,
        formatId: job.formatId ?? null,
        ext: job.ext ?? null,
        status: job.status,
        error: job.error ?? null,
        errorCode: job.errorCode ?? null,
        fileName: job.fileName ?? null,
        sizeBytes: job.sizeBytes ? BigInt(job.sizeBytes) : null,
        batchId: job.batchId ?? null,
        executor: job.executor ?? null,
        handoffError: job.handoffError ?? null,
        createdAt: new Date(job.createdAt),
        startedAt: job.startedAt ? new Date(job.startedAt) : null,
        completedAt: job.completedAt ? new Date(job.completedAt) : null,
      },
    });
  },

  async update(job: DownloadJob): Promise<void> {
    await prisma.download.update({
      where: { id: job.id },
      data: {
        type: job.type,
        title: job.title ?? null,
        uploader: job.uploader ?? null,
        thumbnail: job.thumbnail ?? null,
        duration: job.duration ?? null,
        formatId: job.formatId ?? null,
        ext: job.ext ?? null,
        status: job.status,
        error: job.error ?? null,
        errorCode: job.errorCode ?? null,
        fileName: job.fileName ?? null,
        sizeBytes: job.sizeBytes ? BigInt(job.sizeBytes) : null,
        batchId: job.batchId ?? null,
        executor: job.executor ?? null,
        handoffError: job.handoffError ?? null,
        startedAt: job.startedAt ? new Date(job.startedAt) : null,
        completedAt: job.completedAt ? new Date(job.completedAt) : null,
      },
    });
  },

  async get(id: string): Promise<DownloadJob | null> {
    const row = await prisma.download.findUnique({
      where: { id },
    });
    return row ? rowToDownload(row as DownloadRow) : null;
  },

  async list(filters: DownloadFilters = {}): Promise<DownloadListResult> {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { url: { contains: filters.search, mode: "insensitive" } },
        { uploader: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const [items, total] = await Promise.all([
      prisma.download.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.download.count({ where }),
    ]);

    return {
      items: items.map((row) => rowToDownload(row as DownloadRow)),
      total,
    };
  },

  async delete(id: string): Promise<{ changes: number }> {
    const result = await prisma.download.deleteMany({
      where: { id },
    });
    return { changes: result.count };
  },

  /**
   * Mark orphaned queued/running rows (left by a crashed process) as failed.
   * Only rows created more than STALE_AFTER_MS ago are touched, so a fresh job
   * — or one owned by a live process in a parallel/reboot scenario — is never
   * torn down while it is still making progress.
   */
  async failStaleJobs(message: string): Promise<number> {
    const staleBefore = new Date(
      Date.now() - (Number(process.env.MEDIAVAULT_STALE_JOB_MS) || 30 * 60 * 1000)
    );
    const result = await prisma.download.updateMany({
      where: {
        status: { in: ["queued", "running"] },
        createdAt: { lt: staleBefore },
      },
      data: {
        status: "failed",
        error: message,
        errorCode: "DOWNLOAD_ERROR",
        completedAt: new Date(),
      },
    });
    return result.count;
  },
};

type BatchItemRow = {
  id: string;
  batchId: string;
  position: number;
  url: string;
  status: string;
  error: string | null;
  jobId: string | null;
  createdAt: Date;
};

function rowToBatchItem(row: BatchItemRow) {
  return {
    id: row.id,
    url: row.url,
    position: row.position,
    status: row.status as BatchItemStatus,
    error: row.error,
    jobId: row.jobId,
  };
}

type BatchRow = {
  id: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  createdAt: Date;
  completedAt: Date | null;
  items: BatchItemRow[];
};

function rowToBatch(row: BatchRow): BatchJob {
  const queued = row.items.filter((i) => i.status === "queued").length;
  const running = row.items.filter((i) => i.status === "running").length;

  return {
    id: row.id,
    status: row.status as BatchStatus,
    urls: row.items.map((i) => i.url),
    items: row.items.map(rowToBatchItem),
    counts: {
      total: row.total,
      completed: row.completed,
      failed: row.failed,
      running,
      queued,
      cancelled: row.cancelled,
    },
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export const batchRepository = {
  async insert(
    batch: BatchJob,
    items: Array<{ id: string; url: string }>
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.batch.create({
        data: {
          id: batch.id,
          status: batch.status,
          total: batch.counts.total,
          completed: batch.counts.completed,
          failed: batch.counts.failed,
          cancelled: batch.counts.cancelled,
          createdAt: new Date(batch.createdAt),
          completedAt: batch.completedAt ? new Date(batch.completedAt) : null,
          items: {
            create: items.map((item, index) => ({
              id: item.id,
              position: index,
              url: item.url,
              status: "queued" as const,
              createdAt: new Date(batch.createdAt),
            })),
          },
        },
      });
    });
  },

  async update(batch: BatchJob): Promise<void> {
    await prisma.batch.update({
      where: { id: batch.id },
      data: {
        status: batch.status,
        completed: batch.counts.completed,
        failed: batch.counts.failed,
        cancelled: batch.counts.cancelled,
        completedAt: batch.completedAt ? new Date(batch.completedAt) : null,
      },
    });
  },

  async get(id: string): Promise<BatchJob | null> {
    const row = await prisma.batch.findUnique({
      where: { id },
      include: { items: { orderBy: { position: "asc" } } },
    });
    return row ? rowToBatch(row as BatchRow) : null;
  },

  async updateItem(item: {
    id: string;
    status: string;
    error?: string | null;
    jobId?: string | null;
  }): Promise<void> {
    await prisma.batchItem.update({
      where: { id: item.id },
      data: {
        status: item.status,
        error: item.error ?? null,
        jobId: item.jobId ?? null,
      },
    });
  },

  /** Recompute a batch's counters + status from its actual item rows. */
  async recount(batchId: string): Promise<BatchJob | null> {
    const [grouped, row] = await Promise.all([
      prisma.batchItem.groupBy({
        by: ["status"],
        where: { batchId },
        _count: { _all: true },
      }),
      prisma.batch.findUnique({ where: { id: batchId } }),
    ]);
    if (!row) return null;

    const countFor = (s: string) =>
      grouped.find((g) => g.status === s)?._count._all ?? 0;
    const completed = countFor("completed");
    const failed = countFor("failed");
    const cancelled = countFor("cancelled");
    const running = countFor("running");
    const queued = countFor("queued");
    const total = completed + failed + cancelled + running + queued;
    const done = completed + failed + cancelled;

    const status: BatchStatus =
      done >= total
        ? failed === 0 && cancelled === 0
          ? "completed"
          : completed === 0 && failed > 0
            ? "failed"
            : "partial"
        : "running";

    await prisma.batch.update({
      where: { id: batchId },
      data: {
        status,
        completed,
        failed,
        cancelled,
        completedAt:
          done >= total ? (row.completedAt ?? new Date()) : null,
      },
    });
    return this.get(batchId);
  },

  async delete(id: string): Promise<void> {
    await prisma.batch.delete({ where: { id } });
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  downloadPath: "",
  defaultFormat: "best",
  concurrency: 2,
  keepHistory: true,
  audioFormat: "mp3",
  audioQuality: "5",
  ytdlpPath: "",
  executionMode: "auto",
};

function parseExecutionMode(raw: string | undefined): ExecutionMode {
  return raw === "worker" || raw === "vercel" || raw === "auto" ? raw : "auto";
}

let settingsCache: AppSettings | null = null;
let settingsCachePromise: Promise<AppSettings> | null = null;

export const settingsRepository = {
  async getAll(): Promise<AppSettings> {
    if (settingsCache) return settingsCache;
    if (settingsCachePromise) return settingsCachePromise;

    settingsCachePromise = (async () => {
      try {
        const rows = await prisma.setting.findMany();
        const map: Record<string, string> = {};
        for (const row of rows) map[row.key] = row.value;
        settingsCache = {
          downloadPath: map.downloadPath ?? DEFAULT_SETTINGS.downloadPath,
          defaultFormat: map.defaultFormat ?? DEFAULT_SETTINGS.defaultFormat,
          concurrency: Number(map.concurrency ?? DEFAULT_SETTINGS.concurrency),
          keepHistory: (map.keepHistory ?? String(DEFAULT_SETTINGS.keepHistory)) === "true",
          audioFormat: map.audioFormat ?? DEFAULT_SETTINGS.audioFormat,
          audioQuality: map.audioQuality ?? DEFAULT_SETTINGS.audioQuality,
          ytdlpPath: map.ytdlpPath ?? DEFAULT_SETTINGS.ytdlpPath,
          executionMode: parseExecutionMode(map.executionMode),
        };
        return settingsCache;
      } finally {
        // Clear the in-flight marker even on failure so a transient DB outage
        // (e.g. the local Postgres container is down) does not wedge the
        // settings endpoint for the rest of the process lifetime: the next
        // call retries instead of returning this rejected promise forever.
        settingsCachePromise = null;
      }
    })();
    return settingsCachePromise;
  },

  getAllSync(): AppSettings {
    if (settingsCache) return settingsCache;
    // Fallback to defaults if not loaded yet
    return DEFAULT_SETTINGS;
  },

  async setAll(settings: Partial<AppSettings>): Promise<void> {
    // Merge with the current values so absent keys keep their persisted value
    // (the client only sends the fields the user changed).
    const current = await settingsRepository.getAll();
    const merged: AppSettings = { ...current, ...settings };
    settingsCache = null;
    settingsCachePromise = null;
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(merged) as Array<
        [keyof AppSettings, AppSettings[keyof AppSettings]]
      >) {
        await tx.setting.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        });
      }
    });
  },
};

export async function listBatches(limit = 20): Promise<BatchJob[]> {
  const rows = await prisma.batch.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { items: { orderBy: { position: "asc" } } },
  });
  return rows.map((row) => rowToBatch(row as BatchRow));
}