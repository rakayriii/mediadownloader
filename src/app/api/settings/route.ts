import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { settingsRepository } from "@/lib/db";
import type { AppSettings } from "@/lib/types";

export const runtime = "nodejs";

const VALID_AUDIO_FORMATS = ["mp3", "m4a", "opus", "wav", "aac", "flac", "vorbis"];

/**
 * GET /api/settings
 * Get current application settings.
 */
export async function GET() {
  try {
    const settings = await settingsRepository.getAll();
    return ok({ settings });
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/settings
 * Update application settings.
 */
export async function POST(request: NextRequest) {
  try {
    let body: Partial<AppSettings>;
    try {
      body = (await request.json()) as Partial<AppSettings>;
    } catch {
      throw new AppError("INVALID_INPUT", "Request body must be valid JSON");
    }

    if (body.concurrency !== undefined) {
      const n = Number(body.concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        throw new AppError("INVALID_INPUT", "concurrency must be an integer between 1 and 10");
      }
      body.concurrency = n;
    }

    if (body.audioFormat !== undefined && !VALID_AUDIO_FORMATS.includes(body.audioFormat)) {
      throw new AppError(
        "INVALID_INPUT",
        `audioFormat must be one of: ${VALID_AUDIO_FORMATS.join(", ")}`
      );
    }

    if (body.audioQuality !== undefined) {
      const q = Number(body.audioQuality);
      if (!Number.isInteger(q) || q < 0 || q > 9) {
        throw new AppError("INVALID_INPUT", "audioQuality must be an integer between 0 and 9");
      }
      body.audioQuality = String(q);
    }

    if (body.defaultFormat !== undefined && typeof body.defaultFormat !== "string") {
      throw new AppError("INVALID_INPUT", "defaultFormat must be a string");
    }

    if (body.downloadPath !== undefined && typeof body.downloadPath !== "string") {
      throw new AppError("INVALID_INPUT", "downloadPath must be a string");
    }

    if (body.ytdlpPath !== undefined && typeof body.ytdlpPath !== "string") {
      throw new AppError("INVALID_INPUT", "ytdlpPath must be a string");
    }

    if (body.keepHistory !== undefined && typeof body.keepHistory !== "boolean") {
      throw new AppError("INVALID_INPUT", "keepHistory must be a boolean");
    }

    await settingsRepository.setAll(body);
    const settings = await settingsRepository.getAll();

    return ok({ settings });
  } catch (err) {
    return fail(err);
  }
}