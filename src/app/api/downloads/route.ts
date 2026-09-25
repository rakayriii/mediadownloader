import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { jobManager } from "@/lib/jobs";
import { downloadRepository } from "@/lib/db";
import { assertValidUrl } from "@/lib/validation";
import type { JobType } from "@/lib/types";

export const runtime = "nodejs";

const VALID_AUDIO_FORMATS = ["mp3", "m4a", "opus", "wav", "aac", "flac", "vorbis"];

interface CreateDownloadBody {
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
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * POST /api/downloads
 * Create a download job (video or audio). Returns immediately; progress is
 * polled via GET /api/downloads/[id].
 */
export async function POST(request: NextRequest) {
  try {
    let body: CreateDownloadBody;
    try {
      body = (await request.json()) as CreateDownloadBody;
    } catch {
      throw new AppError("INVALID_INPUT", "Request body must be valid JSON");
    }

    const url = str(body.url);
    if (!url) throw new AppError("INVALID_URL", "url is required");
    await assertValidUrl(url);

    const type: JobType = body.type === "audio" ? "audio" : "video";
    if (body.type !== undefined && body.type !== "video" && body.type !== "audio") {
      throw new AppError("INVALID_INPUT", "type must be 'video' or 'audio'");
    }

    const formatId = str(body.formatId) ?? undefined;

    let audioFormat: string | undefined;
    let audioQuality: string | undefined;
    if (type === "audio") {
      audioFormat = str(body.audioFormat);
      if (audioFormat && !VALID_AUDIO_FORMATS.includes(audioFormat)) {
        throw new AppError(
          "INVALID_INPUT",
          `audioFormat must be one of: ${VALID_AUDIO_FORMATS.join(", ")}`
        );
      }
      audioQuality = str(body.audioQuality);
      if (
        audioQuality &&
        (!/^\d{1,2}$/.test(audioQuality) ||
          Number(audioQuality) < 0 ||
          Number(audioQuality) > 9)
      ) {
        throw new AppError("INVALID_INPUT", "audioQuality must be between 0 and 9");
      }
    } else if (formatId && !/^[\w\s.,+\-_\[\]]{1,64}$/.test(formatId)) {
      throw new AppError("INVALID_FORMAT", "formatId contains invalid characters");
    }

    const duration = body.duration;
    if (duration !== undefined && typeof duration !== "number") {
      throw new AppError("INVALID_INPUT", "duration must be a number");
    }

    const job = await jobManager.create({
      url,
      type,
      formatId,
      audioFormat,
      audioQuality,
      title: str(body.title),
      uploader: str(body.uploader),
      thumbnail: str(body.thumbnail),
      duration: typeof duration === "number" ? duration : undefined,
      ext: str(body.ext),
    });

    return ok({ job }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

/**
 * GET /api/downloads?search=&status=&page=&pageSize=
 * Download history with optional search + status filter.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(searchParams.get("pageSize") ?? "20", 10) || 20, 1),
      100
    );

    if (status && !["queued", "running", "completed", "failed", "cancelled"].includes(status)) {
      throw new AppError("INVALID_INPUT", "status filter is not valid");
    }

    const result = await downloadRepository.list({
      search: search || undefined,
      status: (status || undefined) as never,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    // jobManager.list() merges live registry progress with DB rows, and each
    // row here comes straight from PostgreSQL — the persistent source of truth.
    return ok({ items: result.items, total: result.total, page, pageSize });
  } catch (err) {
    return fail(err);
  }
}