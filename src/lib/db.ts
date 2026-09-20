import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DATABASE_PATH } from "@/lib/config";
import type {
  AppSettings,
  BatchJob,
  BatchStatus,
  BatchItemStatus,
  DownloadJob,
  JobStatus,
} from "@/lib/types";

/**
 * Persistent storage backed by SQLite (node:sqlite — zero native deps).
 * Schema is created on first use; WAL mode keeps reads non-blocking.
 */

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
  const instance = new DatabaseSync(DATABASE_PATH);
  instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA busy_timeout = 5000;");
  instance.exec("PRAGMA foreign_keys = ON;");
  migrate(instance);
  db = instance;
  return db;
}

export function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('video','audio')),
      url TEXT NOT NULL,
      title TEXT,
      uploader TEXT,
      thumbnail TEXT,
      duration INTEGER,
      format_id TEXT,
      ext TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
      error TEXT,
      error_code TEXT,
      file_name TEXT,
      size_bytes INTEGER,
      batch_id TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads (status);
    CREATE INDEX IF NOT EXISTS idx_downloads_title ON downloads (title);
    CREATE INDEX IF NOT EXISTS idx_downloads_batch ON downloads (batch_id);

    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('queued','running','completed','partial','failed','cancelled')),
      total INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      cancelled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
      error TEXT,
      job_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items (batch_id, position);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

type DownloadRow = {
  id: string;
  type: string;
  url: string;
  title: string | null;
  uploader: string | null;
  thumbnail: string | null;
  duration: number | null;
  format_id: string | null;
  ext: string | null;
  status: string;
  error: string | null;
  error_code: string | null;
  file_name: string | null;
  size_bytes: number | null;
  batch_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
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
    formatId: row.format_id ?? undefined,
    ext: row.ext,
    status: row.status as DownloadJob["status"],
    progress: null,
    error: row.error,
    errorCode: (row.error_code as DownloadJob["errorCode"]) ?? null,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    batchId: row.batch_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
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
  insert(job: DownloadJob): void {
    const stmt = getDb().prepare(`
      INSERT INTO downloads (
        id, type, url, title, uploader, thumbnail, duration, format_id, ext,
        status, error, error_code, file_name, size_bytes, batch_id,
        created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.type,
      job.url,
      job.title ?? null,
      job.uploader ?? null,
      job.thumbnail ?? null,
      job.duration ?? null,
      job.formatId ?? null,
      job.ext ?? null,
      job.status,
      job.error ?? null,
      job.errorCode ?? null,
      job.fileName ?? null,
      job.sizeBytes ?? null,
      job.batchId ?? null,
      job.createdAt,
      job.startedAt ?? null,
      job.completedAt ?? null
    );
  },

  update(job: DownloadJob): void {
    const stmt = getDb().prepare(`
      UPDATE downloads SET
        type = ?, title = ?, uploader = ?, thumbnail = ?, duration = ?,
        format_id = ?, ext = ?, status = ?, error = ?, error_code = ?,
        file_name = ?, size_bytes = ?, batch_id = ?, started_at = ?,
        completed_at = ?
      WHERE id = ?
    `);
    stmt.run(
      job.type,
      job.title ?? null,
      job.uploader ?? null,
      job.thumbnail ?? null,
      job.duration ?? null,
      job.formatId ?? null,
      job.ext ?? null,
      job.status,
      job.error ?? null,
      job.errorCode ?? null,
      job.fileName ?? null,
      job.sizeBytes ?? null,
      job.batchId ?? null,
      job.startedAt ?? null,
      job.completedAt ?? null,
      job.id
    );
  },

  get(id: string): DownloadJob | null {
    const row = getDb()
      .prepare("SELECT * FROM downloads WHERE id = ?")
      .get(id) as DownloadRow | undefined;
    return row ? rowToDownload(row) : null;
  },

  list(filters: DownloadFilters = {}): DownloadListResult {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (filters.status) {
      where.push("status = ?");
      params.push(filters.status);
    }
    if (filters.search) {
      where.push("(title LIKE ? OR url LIKE ? OR uploader LIKE ?)");
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const countRow = getDb()
      .prepare(`SELECT COUNT(*) AS total FROM downloads ${whereSql}`)
      .get(...params) as { total: number };

    const rows = getDb()
      .prepare(
        `SELECT * FROM downloads ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as DownloadRow[];

    return {
      items: rows.map(rowToDownload),
      total: Number(countRow.total),
    };
  },

  delete(id: string): void {
    getDb().prepare("DELETE FROM downloads WHERE id = ?").run(id);
  },
};

export interface BatchItemRow {
  id: string;
  batch_id: string;
  position: number;
  url: string;
  status: BatchItemStatus;
  error: string | null;
  job_id: string | null;
  created_at: string;
}

function rowToBatchItem(row: BatchItemRow) {
  return {
    id: row.id,
    url: row.url,
    position: row.position,
    status: row.status,
    error: row.error,
    jobId: row.job_id,
  };
}

function rowToBatch(row: {
  id: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  created_at: string;
  completed_at: string | null;
}): BatchJob {
  const items = (getDb()
    .prepare(
      "SELECT * FROM batch_items WHERE batch_id = ? ORDER BY position ASC"
    )
    .all(row.id) as unknown as BatchItemRow[]).map(rowToBatchItem);

  const queued = items.filter((i) => i.status === "queued").length;
  const running = items.filter((i) => i.status === "running").length;

  return {
    id: row.id,
    status: row.status as BatchStatus,
    urls: items.map((i) => i.url),
    items,
    counts: {
      total: row.total,
      completed: row.completed,
      failed: row.failed,
      running,
      queued,
      cancelled: row.cancelled,
    },
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export const batchRepository = {
  insert(batch: BatchJob, items: Array<{ id: string; url: string }>): void {
    const database = getDb();
    const insertBatch = database.prepare(`
      INSERT INTO batches (id, status, total, completed, failed, cancelled, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertItem = database.prepare(`
      INSERT INTO batch_items (id, batch_id, position, url, status, error, job_id, created_at)
      VALUES (?, ?, ?, ?, 'queued', NULL, NULL, ?)
    `);
    database.exec("BEGIN");
    try {
      insertBatch.run(
        batch.id,
        batch.status,
        batch.counts.total,
        batch.counts.completed,
        batch.counts.failed,
        batch.counts.cancelled,
        batch.createdAt,
        batch.completedAt ?? null
      );
      items.forEach((item, index) => {
        insertItem.run(item.id, batch.id, index, item.url, batch.createdAt);
      });
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }
  },

  update(batch: BatchJob): void {
    getDb()
      .prepare(
        `UPDATE batches SET status = ?, completed = ?, failed = ?, cancelled = ?, completed_at = ? WHERE id = ?`
      )
      .run(
        batch.status,
        batch.counts.completed,
        batch.counts.failed,
        batch.counts.cancelled,
        batch.completedAt ?? null,
        batch.id
      );
  },

  get(id: string): BatchJob | null {
    const row = getDb()
      .prepare("SELECT * FROM batches WHERE id = ?")
      .get(id) as
      | {
          id: string;
          status: string;
          total: number;
          completed: number;
          failed: number;
          cancelled: number;
          created_at: string;
          completed_at: string | null;
        }
      | undefined;
    return row ? rowToBatch(row) : null;
  },

  updateItem(item: {
    id: string;
    status: string;
    error?: string | null;
    jobId?: string | null;
  }): void {
    getDb()
      .prepare(
        "UPDATE batch_items SET status = ?, error = ?, job_id = ? WHERE id = ?"
      )
      .run(item.status, item.error ?? null, item.jobId ?? null, item.id);
  },

  delete(id: string): void {
    getDb().prepare("DELETE FROM batches WHERE id = ?").run(id);
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

export const settingsRepository = {
  getAll(): AppSettings {
    const rows = getDb()
      .prepare("SELECT key, value FROM settings")
      .all() as Array<{ key: string; value: string }>;
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;
    return {
      downloadPath: map.downloadPath ?? DEFAULT_SETTINGS.downloadPath,
      defaultFormat: map.defaultFormat ?? DEFAULT_SETTINGS.defaultFormat,
      concurrency: Number(map.concurrency ?? DEFAULT_SETTINGS.concurrency),
      keepHistory: (map.keepHistory ?? String(DEFAULT_SETTINGS.keepHistory)) === "true",
      audioFormat: map.audioFormat ?? DEFAULT_SETTINGS.audioFormat,
      audioQuality: map.audioQuality ?? DEFAULT_SETTINGS.audioQuality,
      ytdlpPath: map.ytdlpPath ?? DEFAULT_SETTINGS.ytdlpPath,
    };
  },

  setAll(settings: AppSettings): void {
    const database = getDb();
    const upsert = database.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    database.exec("BEGIN");
    try {
      upsert.run("downloadPath", settings.downloadPath);
      upsert.run("defaultFormat", settings.defaultFormat);
      upsert.run("concurrency", String(settings.concurrency));
      upsert.run("keepHistory", String(settings.keepHistory));
      upsert.run("audioFormat", settings.audioFormat);
      upsert.run("audioQuality", settings.audioQuality);
      upsert.run("ytdlpPath", settings.ytdlpPath);
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }
  },
};

export function listBatches(limit = 20): BatchJob[] {
  const rows = getDb()
    .prepare("SELECT * FROM batches ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<{
    id: string;
    status: string;
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    created_at: string;
    completed_at: string | null;
  }>;
  return rows.map(rowToBatch);
}