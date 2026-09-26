import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { jobManager } from "@/lib/jobs";
import { workerClient } from "@/lib/worker-client";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/downloads/[id]/cancel
 *
 * Jobs owned by the remote worker are cancelled there first (so the child
 * yt-dlp process is actually aborted). If the worker is unreachable the local
 * mark-cancelled fallback takes over so the row can never stay "running".
 */
export async function POST(_request: NextRequest, ctx: RouteParams) {
  try {
    const { id } = await ctx.params;
    const job = await jobManager.get(id);
    if (!job) throw new AppError("NOT_FOUND", "Download job not found");

    if (job.executor === "worker") {
      try {
        await workerClient.cancel(id);
      } catch {
        // Worker unreachable; fall through to the local cancellation mark.
      }
    }

    const updated = await jobManager.cancel(id);
    return ok({ job: updated });
  } catch (err) {
    return fail(err);
  }
}