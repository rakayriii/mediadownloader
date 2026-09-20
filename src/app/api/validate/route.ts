import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { validateUrl } from "@/lib/validation";

export const runtime = "nodejs";

interface ValidateBody {
  url?: unknown;
}

/**
 * POST /api/validate
 * Lightweight single-URL validation (used for batch pre-flight checks
 * and quick client-side feedback). Does not contact the media host.
 */
export async function POST(request: NextRequest) {
  try {
    let body: ValidateBody;
    try {
      body = (await request.json()) as ValidateBody;
    } catch {
      throw new AppError("INVALID_INPUT", "Request body must be valid JSON");
    }
    if (typeof body.url !== "string" || body.url.trim().length === 0) {
      throw new AppError("INVALID_URL", "url is required");
    }

    const result = await validateUrl(body.url);
    if (!result.ok) {
      return ok({ valid: false, ...result });
    }
    return ok({ valid: true, url: result.url });
  } catch (err) {
    return fail(err);
  }
}