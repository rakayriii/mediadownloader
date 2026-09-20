import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { jobManager } from "@/lib/jobs";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/downloads/[id]/cancel
 */
export async function POST(_request: NextRequest, ctx: RouteParams) {
  try {
    const { id } = await ctx.params;
    const job = jobManager.get(id);
    if (!job) throw new AppError("NOT_FOUND", "Download job not found");
    const updated = jobManager.cancel(id);
    return ok({ job: updated });
  } catch (err) {
    return fail(err);
  }
}