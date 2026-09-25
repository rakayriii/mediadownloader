import { NextRequest } from "next/server";
import { fail } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { jobManager } from "@/lib/jobs";
import { DOWNLOADS_DIR } from "@/lib/config";
import {
  fetchFromStorage,
  fileStorageKey,
  mimeForExt,
} from "@/lib/storage";
import { createReadStream, statSync, existsSync, readdirSync } from "node:fs";
import { Readable } from "node:stream";
import { join, resolve, basename } from "node:path";
import type { DownloadJob } from "@/lib/types";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Encode filename for Content-Disposition header per RFC 5987.
 * Falls back to ASCII-only filename for legacy compatibility.
 */
function encodeContentDispositionFilename(filename: string): string {
  // Try to use ASCII-only filename (strip non-Latin1 chars)
  const asciiFilename = filename.replace(/[^\x00-\x7F]/g, "_");

  // If filename contains only ASCII, use simple format
  if (asciiFilename === filename) {
    return `filename="${filename}"`;
  }

  // Otherwise use RFC 5987 encoding with UTF-8
  const encoded = encodeURIComponent(filename)
    .replace(/['()]/g, escape) // escape special chars
    .replace(/\*/g, "%2A");

  // Provide both: legacy `filename` (ASCII-safe) and RFC 5987 `filename*`
  return `filename="${asciiFilename}"; filename*=UTF-8''${encoded}`;
}

/**
 * GET /api/downloads/[id]/file
 * Serve the downloaded file for direct playback or download.
 */
export async function GET(request: NextRequest, ctx: RouteParams) {
  try {
    const { id } = await ctx.params;
    const job = await jobManager.get(id);

    if (!job) {
      throw new AppError("NOT_FOUND", "Download job not found");
    }

    if (job.status !== "completed") {
      throw new AppError("INVALID_INPUT", "File is not ready yet");
    }

    if (!job.fileName) {
      throw new AppError("NOT_FOUND", "No file associated with this download");
    }

    // Get the download directory from settings or use default
    const { settingsRepository } = await import("@/lib/db");
    const settings = await settingsRepository.getAll();
    const baseDir = settings.downloadPath
      ? join(settings.downloadPath, "mediavault")
      : DOWNLOADS_DIR;

    // Check if download is forced via query param
    const forceDownload = request.nextUrl.searchParams.get("download") === "1";

    // Try exact filename first
    let filePath = join(baseDir, job.fileName);
    let resolvedFile = resolve(filePath);

    // Security: ensure the file is within the allowed directory
    const resolvedBase = resolve(baseDir);
    if (!resolvedFile.startsWith(resolvedBase)) {
      throw new AppError("BLOCKED_URL", "Invalid file path");
    }

    // If exact match not found, search for file in download directory
    if (!existsSync(filePath)) {
      console.log(`[File API] Exact file not found: ${filePath}, searching directory...`);
      if (!existsSync(baseDir)) {
        // Fresh container/instance: the download dir may never have been
        // created here. Skip straight to the storage mirror.
        console.log(`[File API] Download directory missing: ${baseDir}`);
        const mirrored = await serveFromStorage(
          job,
          request.headers.get("range"),
          forceDownload
        );
        if (mirrored) return mirrored;
        throw new AppError("NOT_FOUND", "File not found on disk");
      }
      const entries = readdirSync(baseDir, { withFileTypes: true });
      const match = entries.find((entry) => {
        if (!entry.isFile()) return false;
        // Match by job ID in filename (yt-dlp includes ID in brackets)
        if (entry.name.includes(`[${job.id}]`)) return true;
        // Match by title if available
        if (job.title) {
          const sanitizedTitle = job.title.replace(/[\\/:*?"<>|]/g, "").trim();
          if (entry.name.startsWith(sanitizedTitle.substring(0, 50))) return true;
        }
        return false;
      });
      if (match) {
        filePath = join(baseDir, match.name);
        resolvedFile = resolve(filePath);
        console.log(`[File API] Found file via search: ${filePath}`);
      } else {
        // Disk miss — the request may be served by an instance that never
        // produced the file. Fall back to the Supabase Storage mirror
        // (env-gated) before giving up.
        const mirrored = await serveFromStorage(
          job,
          request.headers.get("range"),
          forceDownload
        );
        if (mirrored) return mirrored;
        throw new AppError("NOT_FOUND", "File not found on disk");
      }
    }

    if (!existsSync(filePath)) {
      throw new AppError("NOT_FOUND", "File not found on disk");
    }

    const stat = statSync(filePath);
    const fileSize = stat.size;

    // Determine content type based on extension
    const ext = basename(filePath).split(".").pop()?.toLowerCase() || "";
    const contentType = getContentType(ext);

    // Check if download is forced via query param
    const disposition = forceDownload ? "attachment" : "inline";

    // Build Content-Disposition header with proper encoding
    const contentDisposition = `${disposition}; ${encodeContentDispositionFilename(basename(filePath))}`;

    // Handle Range requests for video seeking
    const range = request.headers.get("range");
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const stream = Readable.toWeb(
        createReadStream(filePath, { start, end })
      ) as ReadableStream;

      return new Response(stream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": contentType,
          "Content-Disposition": contentDisposition,
        },
      });
    }

    // Full file response
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

    return new Response(stream, {
      headers: {
        "Content-Length": fileSize.toString(),
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Content-Disposition": contentDisposition,
      },
    });
  } catch (err) {
    return fail(err);
  }
}

function getContentType(ext: string): string {
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

/**
 * Serve a file from the Supabase Storage mirror (env-gated). Returns null when
 * the feature is off, the object is missing, or the fetch failed — callers fall
 * through to their normal NOT_FOUND error in that case.
 */
async function serveFromStorage(
  job: DownloadJob,
  range: string | null,
  forceDownload: boolean
): Promise<Response | null> {
  if (!job.fileName) return null;
  const fetched = await fetchFromStorage(
    fileStorageKey(job.id, job.fileName),
    range
  );
  if (!fetched || fetched.status === 404 || !fetched.body) return null;

  const fileName = basename(job.fileName);
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const contentType = fetched.contentType ?? getContentType(ext) ?? mimeForExt(ext);
  const disposition = forceDownload ? "attachment" : "inline";

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Disposition": `${disposition}; ${encodeContentDispositionFilename(fileName)}`,
  };
  if (fetched.contentLength) headers["Content-Length"] = fetched.contentLength;
  if (fetched.contentRange) headers["Content-Range"] = fetched.contentRange;

  return new Response(fetched.body as unknown as ReadableStream, {
    status: fetched.status,
    headers,
  });
}