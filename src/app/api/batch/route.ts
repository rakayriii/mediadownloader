import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { createBatch } from "@/lib/batch";

export const runtime = "nodejs";

interface BatchBody {
  urls?: unknown;
}

/**
 * POST /api/batch
 * Create a batch download job from a list of URLs.
 */
export async function POST(request: NextRequest) {
  try {
    let body: BatchBody;
    try {
      body = (await request.json()) as BatchBody;
    } catch {
      throw new AppError("INVALID_INPUT", "Request body must be valid JSON");
    }

    if (!Array.isArray(body.urls) || body.urls.length === 0) {
      throw new AppError("INVALID_INPUT", "urls array is required");
    }

    const urls = body.urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0);

    if (urls.length === 0) {
      throw new AppError("INVALID_INPUT", "At least one valid URL is required");
    }

    const result = await createBatch(urls);
    return ok(result, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}