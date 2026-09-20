import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { analyzeMedia } from "@/lib/ytdlp";

export const runtime = "nodejs";

interface AnalyzeBody {
  url?: unknown;
}

/**
 * POST /api/analyze
 * Validate + fetch metadata and available formats/qualities for a media URL.
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

    const media = await analyzeMedia(body.url);
    return ok({ media });
  } catch (err) {
    return fail(err);
  }
}