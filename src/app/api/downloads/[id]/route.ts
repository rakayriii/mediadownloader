import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { jobManager } from "@/lib/jobs";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/downloads/[id]
 * Live job status + metadata (progress, error, file info).
 */
export async function GET(_request: NextRequest, ctx: RouteParams) {
  try {
    const { id } = await ctx.params;
    const job = jobManager.get(id);
    if (!job) throw new AppError("NOT_FOUND", "Download job not found");
    return ok({ job });
  } catch (err) {
    return fail(err);
  }
}

/**
 * DELETE /api/downloads/[id]
 * Cancel a running job (if any) and remove the history entry + output file.
 */
export async function DELETE(_request: NextRequest, ctx: RouteParams) {
  try {
    const { id } = await ctx.params;
    const job = jobManager.get(id);
    if (!job) throw new AppError("NOT_FOUND", "Download job not found");
    jobManager.remove(id);
    return ok({ deleted: true });
  } catch (err) {
    return fail(err);
  }
}