import { prisma } from "@/lib/prisma";
import type {
  AppSettings,
  BatchJob,
  BatchStatus,
  BatchItemStatus,
  DownloadJob,
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
    const result = await prisma.download.delete({
      where: { id },
    });
    return { changes: result ? 1 : 0 };
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
};

let settingsCache: AppSettings | null = null;
let settingsCachePromise: Promise<AppSettings> | null = null;

export const settingsRepository = {
  async getAll(): Promise<AppSettings> {
    if (settingsCache) return settingsCache;
    if (settingsCachePromise) return settingsCachePromise;

    settingsCachePromise = (async () => {
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
      };
      return settingsCache;
    })();
    return settingsCachePromise;
  },

  getAllSync(): AppSettings {
    if (settingsCache) return settingsCache;
    // Fallback to defaults if not loaded yet
    return DEFAULT_SETTINGS;
  },

  async setAll(settings: AppSettings): Promise<void> {
    settingsCache = null;
    settingsCachePromise = null;
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: "downloadPath" },
        create: { key: "downloadPath", value: settings.downloadPath },
        update: { value: settings.downloadPath },
      });
      await tx.setting.upsert({
        where: { key: "defaultFormat" },
        create: { key: "defaultFormat", value: settings.defaultFormat },
        update: { value: settings.defaultFormat },
      });
      await tx.setting.upsert({
        where: { key: "concurrency" },
        create: { key: "concurrency", value: String(settings.concurrency) },
        update: { value: String(settings.concurrency) },
      });
      await tx.setting.upsert({
        where: { key: "keepHistory" },
        create: { key: "keepHistory", value: String(settings.keepHistory) },
        update: { value: String(settings.keepHistory) },
      });
      await tx.setting.upsert({
        where: { key: "audioFormat" },
        create: { key: "audioFormat", value: settings.audioFormat },
        update: { value: settings.audioFormat },
      });
      await tx.setting.upsert({
        where: { key: "audioQuality" },
        create: { key: "audioQuality", value: settings.audioQuality },
        update: { value: settings.audioQuality },
      });
      await tx.setting.upsert({
        where: { key: "ytdlpPath" },
        create: { key: "ytdlpPath", value: settings.ytdlpPath },
        update: { value: settings.ytdlpPath },
      });
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