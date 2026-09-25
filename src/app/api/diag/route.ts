import { resolveFfmpegPath, resolveYtdlpPath } from "@/lib/config";
import { runCommand } from "@/lib/tools";

export const runtime = "nodejs";

/**
 * TEMPORARY production diagnostic endpoint (GET /api/diag).
 *
 * The TikTok analyzer is verified working on localhost/residential IPs but
 * fails on Vercel. This endpoint reports the exact toolchain the deployed
 * container uses and re-runs the exact yt-dlp invocation analyzeMedia() makes
 * against a HARDCODED public test URL, so the deployed-vs-local discrepancy is
 * observable without touching the downloader.
 *
 * Safety (production-safe by construction):
 *  - GET only; no request input is used — the URL and flags are hardcoded, so
 *    this cannot be pointed at arbitrary hosts (no SSRF surface).
 *  - Returns only: tool versions, resolved paths, exit code, timedOut flag,
 *    stdout/stderr lengths, sanitized first 1KB of stderr, whether stdout is
 *    valid JSON, and a sanitized error message.
 *  - Never returns cookies, headers, tokens, environment variables, or the
 *    full yt-dlp info JSON.
 *
 * Delete this route once the discrepancy is diagnosed.
 */
const TEST_URL = "https://vt.tiktok.com/ZSq9RVghw/";

const ANALYZE_ARGS = [
  "-J",
  "--no-playlist",
  "--skip-download",
  "--no-warnings",
  "--no-check-formats",
  "--socket-timeout",
  "30",
  TEST_URL,
];

/** Strip ANSI escape sequences and control characters; cap length. */
function sanitize(text: string, max: number): string {
  return text
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, max);
}

/** First byte of a version command's stdout (e.g. "Python 3.11.8"). */
async function versionOf(
  command: string,
  args: string[]
): Promise<{ version: string | null; ok: boolean }> {
  try {
    const result = await runCommand(command, args, { timeoutMs: 15_000 });
    const first = result.stdout.split("\n")[0]?.trim() || null;
    return { version: first, ok: result.code === 0 };
  } catch {
    return { version: null, ok: false };
  }
}

export async function GET() {
  const ytdlpPath = resolveYtdlpPath();
  const ffmpegPath = resolveFfmpegPath();

  const ytdlpVersion = ytdlpPath
    ? await versionOf(ytdlpPath, ["--version"])
    : { version: null, ok: false };
  const pythonVersion = await versionOf("python3", ["--version"]);
  const ffmpegVersion = ffmpegPath
    ? await versionOf(ffmpegPath, ["-version"])
    : { version: null, ok: false };

  let analyze = {
    exitCode: null as number | null,
    timedOut: false,
    stdoutLength: 0,
    stderrLength: 0,
    stderrHead: "",
    stdoutValidJson: false,
    error: "",
  };

  if (ytdlpPath) {
    try {
      const result = await runCommand(ytdlpPath, ANALYZE_ARGS, {
        timeoutMs: 60_000,
      });
      let stdoutValidJson = false;
      try {
        JSON.parse(result.stdout);
        stdoutValidJson = true;
      } catch {
        // not valid JSON
      }
      let error = "";
      if (result.code !== 0) {
        const errorLine = result.stderr
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith("ERROR:"));
        error = sanitize(errorLine ?? result.stderr, 1000);
      }
      analyze = {
        exitCode: result.code,
        timedOut: result.timedOut,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
        stderrHead: sanitize(result.stderr, 1000),
        stdoutValidJson,
        error,
      };
    } catch {
      analyze = {
        exitCode: null,
        timedOut: false,
        stdoutLength: 0,
        stderrLength: 0,
        stderrHead: sanitize("failed to spawn yt-dlp", 1000),
        stdoutValidJson: false,
        error: "yt-dlp could not be spawned",
      };
    }
  } else {
    analyze = {
      exitCode: null,
      timedOut: false,
      stdoutLength: 0,
      stderrLength: 0,
      stderrHead: "",
      stdoutValidJson: false,
      error: "yt-dlp binary not found",
    };
  }

  return new Response(
    JSON.stringify(
      {
        versions: {
          ytdlp: ytdlpVersion.version,
          python: pythonVersion.version,
          ffmpeg: ffmpegVersion.version,
        },
        paths: {
          ytdlp: ytdlpPath,
          ffmpeg: ffmpegPath,
        },
        ytdlpExecutable: ytdlpVersion.ok,
        url: TEST_URL,
        analyze,
      },
      null,
      2
    ),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }
  );
}