/**
 * Application error hierarchy with stable machine-readable codes.
 * Codes map 1:1 to client-facing error messages and HTTP statuses.
 */

export type ErrorCode =
  | "INVALID_URL"
  | "BLOCKED_URL"
  | "UNSUPPORTED_URL"
  | "MEDIA_UNAVAILABLE"
  | "INVALID_FORMAT"
  | "INVALID_INPUT"
  | "YTDLP_ERROR"
  | "YTDLP_NOT_FOUND"
  | "FFMPEG_ERROR"
  | "FFMPEG_NOT_FOUND"
  | "TIMEOUT"
  | "DOWNLOAD_ERROR"
  | "DOWNLOAD_CANCELLED"
  | "NOT_FOUND"
  | "INTERNAL";

const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  BLOCKED_URL: 422,
  UNSUPPORTED_URL: 422,
  MEDIA_UNAVAILABLE: 404,
  INVALID_FORMAT: 400,
  INVALID_INPUT: 400,
  YTDLP_ERROR: 502,
  YTDLP_NOT_FOUND: 503,
  FFMPEG_ERROR: 502,
  FFMPEG_NOT_FOUND: 503,
  TIMEOUT: 504,
  DOWNLOAD_ERROR: 502,
  DOWNLOAD_CANCELLED: 409,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? errorMessage[code]);
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof Error) {
    return new AppError("INTERNAL", err.message);
  }
  return new AppError("INTERNAL", "Unexpected server error");
}

export const errorMessage: Record<ErrorCode, string> = {
  INVALID_URL: "The URL is not valid. Provide a full http(s) link to a media page.",
  BLOCKED_URL: "This URL is not allowed. Local, private, and reserved addresses are blocked.",
  UNSUPPORTED_URL: "This URL is not supported by the media extractor.",
  MEDIA_UNAVAILABLE: "The media is unavailable or no download formats were found.",
  INVALID_FORMAT: "The selected format is not available for this media.",
  INVALID_INPUT: "The request is missing required fields or contains invalid values.",
  YTDLP_ERROR: "The media extractor could not process this URL.",
  YTDLP_NOT_FOUND: "yt-dlp is not installed on the server. Install it to enable downloads.",
  FFMPEG_ERROR: "Audio/video processing failed on the server.",
  FFMPEG_NOT_FOUND: "ffmpeg is not installed on the server. Install it to enable merging video and audio streams, or select a pre-merged format.",
  TIMEOUT: "The operation timed out. Try again or use a different source.",
  DOWNLOAD_ERROR: "The download failed.",
  DOWNLOAD_CANCELLED: "The download was cancelled.",
  NOT_FOUND: "The requested resource was not found.",
  INTERNAL: "An unexpected server error occurred.",
};