/**
 * Optional, env-gated mirror of downloaded files into Supabase Storage.
 *
 * Why this exists: Vercel container disks are ephemeral and requests can land
 * on a *different* instance than the one that ran the download, so files
 * written only to the local disk are effectively lost (GET /file → 404 despite
 * a completed job). When SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set,
 * completed downloads are mirrored to a private Storage bucket and the file
 * endpoint falls back to reading from that mirror.
 *
 * Free-tier friendly: object size is capped (~50 MB/object), so audio and
 * smaller videos get mirrored; oversized files stay disk-only (they keep
 * working on the instance that produced them). Upload/delete/read failures
 * degrade silently — the local disk remains the primary store.
 */

export interface StorageConfig {
  url: string; // e.g. https://xxxx.supabase.co
  serviceRole: string;
  bucket: string;
}

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "mediavault";

/** Returns storage config when the feature is enabled, else null. */
export function supabaseStorage(): StorageConfig | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return {
    url: url.replace(/\/+$/, ""),
    serviceRole,
    bucket: BUCKET,
  };
}

/** Deterministic object key for a completed download. */
export function fileStorageKey(jobId: string, fileName: string): string {
  return `downloads/${jobId}/${fileName}`;
}

function headersFor(
  storage: StorageConfig,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    apikey: storage.serviceRole,
    Authorization: `Bearer ${storage.serviceRole}`,
    ...extra,
  };
}

/**
 * Mirror a local file to storage. Best-effort: returns false (never throws)
 * when the feature is off, the local file is empty/missing, or the object
 * exceeds the plan's size limit (e.g. EntityTooLarge).
 */
export async function mirrorToStorage(
  localPath: string,
  key: string,
  contentType: string
): Promise<boolean> {
  const storage = supabaseStorage();
  if (!storage) return false;
  try {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(localPath);
    if (bytes.byteLength === 0) return false;
    const res = await fetch(
      `${storage.url}/storage/v1/object/${storage.bucket}/${key}`,
      {
        method: "POST",
        headers: headersFor(storage, { "Content-Type": contentType }),
        body: bytes,
      }
    );
    if (!res.ok) {
      console.warn(
        `[Storage] Mirror upload failed (${res.status}): ${await res
          .text()
          .catch(() => "")}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[Storage] Mirror upload error:", err);
    return false;
  }
}

/** Remove a mirrored object. Best-effort, idempotent (404s are fine). */
export async function deleteFromStorage(key: string): Promise<void> {
  const storage = supabaseStorage();
  if (!storage) return;
  try {
    const res = await fetch(
      `${storage.url}/storage/v1/object/${storage.bucket}/${key}`,
      { method: "DELETE", headers: headersFor(storage) }
    );
    if (!res.ok && res.status !== 404) {
      console.warn(`[Storage] Mirror delete failed (${res.status}): ${key}`);
    }
  } catch (err) {
    console.warn("[Storage] Mirror delete error:", err);
  }
}

export interface StorageFetchResult {
  status: number;
  contentType: string | null;
  contentLength: string | null;
  contentRange: string | null;
  body: ReadableStream | null;
}

/** Fetch a mirrored object, optionally honoring a Range header. */
export async function fetchFromStorage(
  key: string,
  range: string | null
): Promise<StorageFetchResult | null> {
  const storage = supabaseStorage();
  if (!storage) return null;
  try {
    const res = await fetch(
      `${storage.url}/storage/v1/object/${storage.bucket}/${key}`,
      {
        headers: headersFor(storage, range ? { Range: range } : undefined),
      }
    );
    if (res.status === 404) return null;
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: res.headers.get("content-length"),
      contentRange: res.headers.get("content-range"),
      body: res.body,
    };
  } catch (err) {
    console.warn("[Storage] Mirror read error:", err);
    return null;
  }
}

/** Simple extension → MIME map (mirrors the file endpoint's table). */
export function mimeForExt(ext: string): string {
  const types: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    opus: "audio/opus",
    wav: "audio/wav",
    aac: "audio/aac",
    flac: "audio/flac",
    vorbis: "audio/vorbis",
    ogg: "audio/ogg",
  };
  return types[ext] || "application/octet-stream";
}