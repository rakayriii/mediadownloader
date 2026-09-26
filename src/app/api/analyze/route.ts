import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { AppError, toAppError } from "@/lib/errors";
import { analyzeMedia } from "@/lib/ytdlp";
import { settingsRepository } from "@/lib/db";
import { isHandoffErrorCode } from "@/lib/executors";
import { workerClient, workerConfigured } from "@/lib/worker-client";

export const runtime = "nodejs";

interface AnalyzeBody {
  url?: unknown;
}

/**
 * POST /api/analyze
 * Validate + fetch metadata and available formats/qualities for a media URL.
 *
 * Routing follows the executionMode setting:
 *  - "vercel": analyze here (this server), like always.
 *  - "worker": analyze on the remote worker (sources blocked from Vercel,
 *    e.g. TikTok, resolve correctly from the worker's residential IP).
 *  - "auto": try this server first; on a network/extractor failure fall back
 *    to the worker once. If both fail the original error is kept and the
 *    worker's failure is appended. Nothing is hidden.
 */
export async function POST(request: NextRequest) {
  try {
    let body: AnalyzeBody;
    try {
      body = (await request.json()) as AnalyzeBody;
    } catch {
      throw new AppError("INVALID_INPUT", "Request body must be valid JSON");
    }

    if (typeof body.url !== "string" || body.url.trim().length === 0) {
      throw new AppError("INVALID_URL", "url is required");
    }

    const mode = (await settingsRepository.getAll()).executionMode;

    // Worker-only mode: analyze there directly.
    if (mode === "worker") {
      const media = await workerClient.analyze(body.url);
      return ok({ media });
    }

    try {
      const media = await analyzeMedia(body.url);
      return ok({ media });
    } catch (err) {
      // AUTO: local analyze hit a network/extractor failure; try the worker.
      if (
        mode === "auto" &&
        workerConfigured() &&
        isHandoffErrorCode(toAppError(err).code)
      ) {
        try {
          const media = await workerClient.analyze(body.url);
          return ok({ media });
        } catch (workerErr) {
          const appErr = toAppError(err);
          const workerMsg = toAppError(workerErr).message;
          throw new AppError(
            appErr.code,
            `${appErr.message}; Worker attempt failed: ${workerMsg}`
          );
        }
      }
      throw err;
    }
  } catch (err) {
    return fail(err);
  }
}