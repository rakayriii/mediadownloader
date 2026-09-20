import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DOWNLOADS_DIR,
  SWEEP_INTERVAL_MINUTES,
  TEMP_DIR,
  TEMP_FILE_TTL_MINUTES,
} from "@/lib/config";

/**
 * Best-effort temp/partial file cleanup. Removes:
 *  - stale files inside TEMP_DIR (per-job work dirs)
 *  - orphaned `.part` files inside the downloads dir
 */

let started = false;

export async function sweepTempFiles(now = Date.now()): Promise<number> {
  const ttlMs = TEMP_FILE_TTL_MINUTES * 60 * 1000;
  let removed = 0;

  // Per-job work dirs under TEMP_DIR
  try {
    const entries = await readdir(TEMP_DIR);
    for (const entry of entries) {
      const full = join(TEMP_DIR, entry);
      try {
        const s = await stat(full);
        if (s.isDirectory() && now - s.mtimeMs > ttlMs) {
          await rm(full, { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // TEMP_DIR may not exist yet
  }

  // Orphaned .part downloads (interrupted downloads)
  try {
    const entries = await readdir(DOWNLOADS_DIR);
    for (const entry of entries) {
      if (!entry.endsWith(".part")) continue;
      const full = join(DOWNLOADS_DIR, entry);
      try {
        const s = await stat(full);
        if (now - s.mtimeMs > ttlMs) {
          await rm(full, { force: true });
          removed += 1;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // downloads dir may not exist yet
  }

  return removed;
}

/** Start an interval that keeps temp files in check. Idempotent. */
export function startSweeper(): void {
  if (started) return;
  started = true;
  const intervalMs = Math.max(SWEEP_INTERVAL_MINUTES * 60 * 1000, 60_000);
  const timer = setInterval(() => {
    void sweepTempFiles().catch(() => undefined);
  }, intervalMs);
  timer.unref();
  void sweepTempFiles().catch(() => undefined);
}