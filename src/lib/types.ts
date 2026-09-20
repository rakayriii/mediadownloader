/**
 * Shared type definitions for the MediaVault API and job system.
 */

export type JobType = "video" | "audio";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type BatchStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type BatchItemStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface FormatOption {
  /** Machine id passed back to the download API (yt-dlp format id or synthetic). */
  id: string;
  /** Human label, e.g. "1080p • MP4". */
  label: string;
  ext: string;
  container?: string;
  resolution?: string;
  height?: number;
  fps?: number;
  filesize?: number;
  filesizeApprox?: number;
  bitrateKbps?: number;
  vcodec?: string | null;
  acodec?: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Recommended default selection for the UI. */
  isRecommended?: boolean;
  /** Whether the format requires server-side remux/merge (multiple files). */
  requiresMerge?: boolean;
  group: "video" | "audio";
  qualityLabel?: string;
  /** Additional descriptive note for the UI. */
  note?: string;
}

export interface MediaInfo {
  url: string;
  webpageUrl: string;
  id: string;
  title: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
  channel?: string;
  uploadDate?: string;
  viewCount?: number;
  likeCount?: number;
  extractor: string;
  extractorKey: string;
  live?: boolean;
  ageLimit?: number;
  isPlaylist?: boolean;
  formats: FormatOption[];
  qualities: string[];
}

export interface AnalyzeResult {
  media: MediaInfo;
}

export type ProgressStage =
  | "queued"
  | "analyzing"
  | "downloading"
  | "processing"
  | "finalizing";

export interface JobProgress {
  stage: ProgressStage;
  percent?: number;
  speed?: string;
  eta?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

export interface DownloadJob {
  id: string;
  type: JobType;
  url: string;
  title?: string | null;
  uploader?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
  formatId?: string;
  ext?: string | null;
  status: JobStatus;
  progress: JobProgress | null;
  error?: string | null;
  errorCode?: ErrorCodeString | null;
  fileName?: string | null;
  sizeBytes?: number | null;
  batchId?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export type ErrorCodeString =
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

export interface BatchItem {
  id: string;
  url: string;
  position: number;
  status: BatchItemStatus;
  error?: string | null;
  jobId?: string | null;
}

export interface BatchJob {
  id: string;
  status: BatchStatus;
  urls: string[];
  items: BatchItem[];
  counts: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    queued: number;
    cancelled: number;
  };
  createdAt: string;
  completedAt?: string | null;
}

export interface AppSettings {
  /** Directory that completed files are copied/stored in. */
  downloadPath: string;
  /** Default format selection for new downloads. */
  defaultFormat: string;
  /** Maximum simultaneous background downloads. */
  concurrency: number;
  /** Whether completed downloads are retained in history. */
  keepHistory: boolean;
  /** Audio format used by default in the audio extractor. */
  audioFormat: string;
  /** Audio quality (0–9) passed to the encoder. */
  audioQuality: string;
  /** yt-dlp binary override (may be empty to auto-detect). */
  ytdlpPath: string;
}

export interface ApiOk<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: ErrorCodeString;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiOk<T> | ApiError;

export function isApiError<T>(res: ApiResponse<T>): res is ApiError {
  return "error" in res;
}

export interface Pagination {
  total: number;
  page: number;
  pageSize: number;
}