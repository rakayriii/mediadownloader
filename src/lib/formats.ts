import type { FormatOption } from "@/lib/types";

/**
 * Maps raw yt-dlp format descriptors into clean, UI-friendly format groups
 * (video qualities + audio-only options).
 */

export interface YtFormat {
  format_id: string;
  ext?: string;
  resolution?: string;
  height?: number;
  width?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  vbr?: number;
  abr?: number;
  format_note?: string;
  format?: string;
  protocol?: string;
  url?: string;
  language?: string;
  dynamic_range?: string;
  quality?: number;
}

interface YtDump {
  _type?: string;
  ie_key?: string;
  extractor_key?: string;
  extractor?: string;
  title?: string;
  id?: string;
  webpage_url?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  channel?: string;
  upload_date?: string;
  view_count?: number;
  like_count?: number;
  description?: string;
  is_live?: boolean;
  age_limit?: number;
  formats?: YtFormat[];
}

export type { YtDump };

const isNone = (codec?: string): boolean =>
  !codec || codec === "none" || codec === "NONE";

function shortCodec(codec?: string): string | null {
  if (!codec || codec === "none" || codec === "NONE") return null;
  const c = codec.toLowerCase();
  if (c.startsWith("avc1") || c.startsWith("h264") || c.startsWith("x264")) return "H.264";
  if (c.startsWith("av01") || c.startsWith("av1")) return "AV1";
  if (c.startsWith("vp9")) return "VP9";
  if (c.startsWith("vp8")) return "VP8";
  if (c.startsWith("hev1") || c.startsWith("hvc1") || c.startsWith("hevc")) return "HEVC";
  if (c.startsWith("mp4a")) return "AAC";
  if (c.startsWith("opus")) return "Opus";
  if (c.startsWith("vorbis") || c.startsWith("vor")) return "Vorbis";
  if (c.startsWith("mp3")) return "MP3";
  if (c.startsWith("flac")) return "FLAC";
  if (c.startsWith("ac-3") || c.startsWith("ac3")) return "AC-3";
  if (c.startsWith("dts")) return "DTS";
  if (c.startsWith("aac")) return "AAC";
  if (c.startsWith("pcm")) return "PCM";
  return codec.split(".")[0]; // something else — keep the family name
}

function formatBytes(bytes: number | undefined): string | null {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes) || bytes <= 0) {
    return null;
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)}${units[i]}`;
}

function extFor(f: YtFormat): string {
  return (f.ext ?? "unknown").toLowerCase();
}

export interface MappedFormats {
  formats: FormatOption[];
  qualities: string[];
}

/**
 * Build the format list:
 *  - "best" synthetic recommended option
 *  - video qualities grouped by height, descending
 *  - audio-only formats sorted by bitrate, descending
 */
export function mapFormats(dump: YtDump): MappedFormats {
  const raw = (dump.formats ?? []).filter((f) => f.format_id && f.url !== undefined);
  const formats: FormatOption[] = [];
  const seen: Set<string> = new Set();

  const add = (option: FormatOption) => {
    if (seen.has(option.id)) return;
    seen.add(option.id);
    formats.push(option);
  };

  // ---------- Best (recommended) ----------
  add({
    id: "best",
    label: "Best available",
    ext: "mp4",
    container: "mp4",
    hasVideo: true,
    hasAudio: true,
    group: "video",
    isRecommended: true,
    note: "Highest quality merged automatically",
  });

  // ---------- Video formats by height ----------
  const videoFormats = raw.filter(
    (f) => !isNone(f.vcodec) && (f.height ?? 0) > 0
  );
  const heights = [...new Set(videoFormats.map((f) => f.height ?? 0))]
    .sort((a, b) => b - a);

  const bestVideoAt = (height: number): YtFormat | undefined => {
    const atHeight = videoFormats.filter((f) => f.height === height);
    if (atHeight.length === 0) return undefined;
    return atHeight.sort((a, b) => {
      const score = (x: YtFormat) =>
        (x.tbr ?? 0) + (x.vbr ?? 0) + (x.filesize ?? 0) / 1e6;
      return score(b) - score(a);
    })[0];
  };

  const combinedAt = (height: number): YtFormat | undefined =>
    videoFormats
      .filter((f) => f.height === height && !isNone(f.acodec))
      .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];

  const qualityLabel = (height: number): string =>
    height >= 2000 ? "4K" : height >= 1400 ? "1440p" : `${height}p`;

  for (const height of heights.slice(0, 12)) {
    const combined = combinedAt(height);
    const pick = combined ?? bestVideoAt(height);
    if (!pick) continue;

    const h264 = isNone(pick.vcodec) || shortCodec(pick.vcodec) === "H.264";
    const ext = h264 ? "mp4" : extFor(pick);
    const filesize = pick.filesize ?? pick.filesize_approx;

    if (combined) {
      add({
        id: combined.format_id,
        label: `${qualityLabel(height)} • ${ext}`,
        ext,
        container: ext,
        resolution: `${pick.width ?? ""}x${height}`.replace(/^x/, ""),
        height,
        fps: pick.fps,
        filesize,
        bitrateKbps: pick.tbr,
        vcodec: shortCodec(pick.vcodec),
        acodec: shortCodec(pick.acodec),
        hasVideo: true,
        hasAudio: true,
        group: "video",
        note: [shortCodec(pick.vcodec), shortCodec(pick.acodec), formatBytes(filesize)]
          .filter(Boolean)
          .join(" • ") || undefined,
      });
    } else {
      const spec = `${pick.format_id}+bestaudio`;
      add({
        id: spec,
        label: `${qualityLabel(height)} • ${ext}`,
        ext,
        container: ext,
        resolution: `${pick.width ?? ""}x${height}`.replace(/^x/, ""),
        height,
        fps: pick.fps,
        filesize,
        bitrateKbps: pick.tbr,
        vcodec: shortCodec(pick.vcodec),
        acodec: "best",
        hasVideo: true,
        hasAudio: true,
        requiresMerge: true,
        group: "video",
        note: [
          shortCodec(pick.vcodec),
          formatBytes(filesize),
          "merged with best audio",
        ]
          .filter(Boolean)
          .join(" • ") || undefined,
      });
    }
  }

  // ---------- Audio-only ----------
  const audioFormats = raw
    .filter((f) => isNone(f.vcodec) && !isNone(f.acodec))
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));

  const audioByExt = new Map<string, YtFormat>();
  for (const f of audioFormats) {
    const ext = extFor(f);
    if (ext === "unknown" || ext === "mhtml") continue;
    if (!audioByExt.has(ext)) audioByExt.set(ext, f);
  }

  for (const [ext, f] of audioByExt) {
    if (formats.length >= 24) break;
    const abr = f.abr ?? 0;
    const quality =
      abr >= 300 ? "320kbps" : abr >= 250 ? "256kbps" : abr >= 128 ? `${Math.round(abr)}kbps` : "Best";
    add({
      id: f.format_id,
      label: `${ext.toUpperCase()} • ${quality}`,
      ext: ext === "m4a" ? "m4a" : ext,
      container: ext,
      filesize: f.filesize ?? f.filesize_approx,
      bitrateKbps: abr,
      vcodec: null,
      acodec: shortCodec(f.acodec),
      hasVideo: false,
      hasAudio: true,
      group: "audio",
      note: [shortCodec(f.acodec), formatBytes(f.filesize ?? f.filesize_approx)]
        .filter(Boolean)
        .join(" • ") || undefined,
    });
  }

  return {
    formats,
    qualities: heights.slice(0, 8).map(qualityLabel),
  };
}