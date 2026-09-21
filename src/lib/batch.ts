import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { MAX_BATCH_SIZE } from "@/lib/config";
import { batchRepository } from "@/lib/db";
import { jobManager } from "@/lib/jobs";
import { validateUrl } from "@/lib/validation";
import type { BatchJob } from "@/lib/types";

/**
 * Batch download orchestration: validates a list of URLs, records a batch,
 * and enqueues one download job per valid URL through the shared queue.
 */

export interface CreateBatchResult {
  batch: BatchJob;
  invalidCount: number;
}

interface WhitelistedMeta {
  url: string;
  title?: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
}

export async function createBatch(urlsRaw: string[]): Promise<CreateBatchResult> {
  if (!Array.isArray(urlsRaw) || urlsRaw.length === 0) {
    throw new AppError("INVALID_INPUT", "Provide at least one URL");
  }
  if (urlsRaw.length > MAX_BATCH_SIZE) {
    throw new AppError(
      "INVALID_INPUT",
      `A batch supports at most ${MAX_BATCH_SIZE} URLs at once`
    );
  }

  const now = new Date().toISOString();
  const batchId = randomUUID();

  const items = urlsRaw.map((raw, index) => ({
    id: randomUUID(),
    url: raw.trim(),
    position: index,
  }));

  const valid: Array<{ item: (typeof items)[number]; meta: WhitelistedMeta }> = [];
  for (const item of items) {
    const check = await validateUrlSafe(item.url);
    if (!check.ok || !check.url) {
      await batchRepository.updateItem({
        id: item.id,
        status: "failed",
        error: check.error ?? "Invalid URL",
      });
      continue;
    }
    valid.push({ item, meta: { url: check.url } });
  }

  const initialBatch: BatchJob = {
    id: batchId,
    status: valid.length === 0 ? "failed" : "running",
    urls: items.map((i) => i.url),
    items: items.map((i) => ({ id: i.id, url: i.url, position: i.position, status: "queued" })),
    counts: {
      total: items.length,
      completed: 0,
      failed: valid.length === 0 ? items.length : 0,
      running: 0,
      queued: valid.length,
      cancelled: 0,
    },
    createdAt: now,
    completedAt: null,
  };

  await batchRepository.insert(initialBatch, items);

  if (valid.length === 0) {
    await batchRepository.update({
      ...initialBatch,
      status: "failed",
      completedAt: now,
    });
    const failedBatch = await batchRepository.get(batchId);
    return { batch: failedBatch!, invalidCount: items.length };
  }

  // Enqueue child jobs — each links back to the batch and its item.
  for (const { item, meta } of valid) {
    const job = jobManager.create({
      url: meta.url,
      type: "video",
      formatId: undefined,
      title: meta.title,
      uploader: meta.uploader,
      thumbnail: meta.thumbnail,
      duration: meta.duration,
      batchId,
    });
    await batchRepository.updateItem({
      id: item.id,
      status: "running",
      jobId: job.id,
    });
  }

  const fresh = await batchRepository.get(batchId);
  return { batch: fresh!, invalidCount: items.length - valid.length };
}

async function validateUrlSafe(raw: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: "URL is required" };
  }
  return validateUrl(raw);
}