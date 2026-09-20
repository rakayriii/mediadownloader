import { NextResponse } from "next/server";
import { AppError, errorMessage, toAppError } from "@/lib/errors";
import type { ApiError, ApiResponse } from "@/lib/types";

/**
 * Consistent API envelope: `{ data }` on success, `{ error: { code, message } }`
 * on failure with the matching HTTP status.
 */

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ data } satisfies ApiResponse<T>, init);
}

export function fail(err: unknown, init?: ResponseInit): NextResponse<ApiError> {
  const appError = toAppError(err);
  const message =
    appError.message && appError.message !== "INTERNAL"
      ? appError.message
      : errorMessage[appError.code];

  const body: ApiError = {
    error: {
      code: appError.code,
      message,
      ...(appError.details !== undefined
        ? { details: appError.details }
        : {}),
    },
  };
  return NextResponse.json(body, { status: appError.status, ...init });
}

export function unknownToAppError(err: unknown): AppError {
  return toAppError(err);
}