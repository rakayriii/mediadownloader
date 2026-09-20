import { spawn } from "node:child_process";
import { AppError } from "@/lib/errors";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
}

export interface RunCommandOptions {
  timeoutMs?: number;
  /** Called for every line written to stdout (newline-delimited). */
  onStdoutLine?: (line: string) => void;
  /** Called for every line written to stderr. */
  onStderrLine?: (line: string) => void;
  /** Called when the process is killed early (timeout or cancel). */
  onKill?: () => void;
  /** Cap captured output at this many bytes (default 2 MB). */
  maxOutputBytes?: number;
  env?: Record<string, string>;
  cwd?: string;
  /** Abort the child process when the signal fires. */
  signal?: AbortSignal;
}

/**
 * Spawn a command with a hard timeout. Never lets the caller pass user input
 * into a shell string: args are passed as an array, so no shell injection.
 */
export function runCommand(
  executable: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<RunResult> {
  const {
    timeoutMs = 60_000,
    onStdoutLine,
    onStderrLine,
    onKill,
    maxOutputBytes = 2 * 1024 * 1024,
    env,
    cwd,
    signal,
  } = options;

  return new Promise<RunResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted before start"));
      return;
    }

    const child = spawn(executable, args, {
      env: { ...process.env, ...env },
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutCut = false;
    let stderrCut = false;
    let timedOut = false;
    let killed = false;
    let finished = false;

    const onAbort = () => {
      killed = true;
      child.kill("SIGKILL");
      onKill?.();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code: child.exitCode, stdout, stderr, timedOut, killed });
    };

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("exit", (code) => {
      if (timedOut) {
        killed = true;
        onKill?.();
      }
      void code;
      finish();
    });

    child.on("close", () => finish());

    const handleLine = (line: string, isErr: boolean) => {
      if (isErr) {
        if (!stderrCut) stderr += line + "\n";
        if (stderr.length > maxOutputBytes) {
          stderr = stderr.slice(0, maxOutputBytes);
          stderrCut = true;
        }
        onStderrLine?.(line);
      } else {
        if (!stdoutCut) stdout += line + "\n";
        if (stdout.length > maxOutputBytes) {
          stdout = stdout.slice(0, maxOutputBytes);
          stdoutCut = true;
        }
        onStdoutLine?.(line);
      }
    };

    let stdoutBuffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = stdoutBuffer.indexOf("\n")) !== -1) {
        const line = stdoutBuffer.slice(0, idx);
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        handleLine(line, false);
      }
    });
    child.stdout?.on("end", () => {
      if (stdoutBuffer.length > 0) {
        handleLine(stdoutBuffer, false);
        stdoutBuffer = "";
      }
    });

    let stderrBuffer = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = stderrBuffer.indexOf("\n")) !== -1) {
        const line = stderrBuffer.slice(0, idx);
        stderrBuffer = stderrBuffer.slice(idx + 1);
        handleLine(line, true);
      }
    });
    child.stderr?.on("end", () => {
      if (stderrBuffer.length > 0) {
        handleLine(stderrBuffer, true);
        stderrBuffer = "";
      }
    });
  });
}

/** Category helper for common executable errors. */
export function isExecutableMissing(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

export class CommandFailedError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut: boolean;

  constructor(message: string, opts: { exitCode: number | null; stderr: string; stdout: string; timedOut: boolean }) {
    super(message);
    this.name = "CommandFailedError";
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
    this.stdout = opts.stdout;
    this.timedOut = opts.timedOut;
  }
}

/** Run a command and reject with a rich error when it fails or times out. */
export async function runCommandChecked(
  executable: string,
  args: string[],
  options: RunCommandOptions & { errorMessage?: string } = {}
): Promise<RunResult> {
  const result = await runCommand(executable, args, options);
  if (result.code !== 0) {
    const why = result.timedOut
      ? "command timed out"
      : `exit code ${result.code}`;
    throw new CommandFailedError(
      `${options.errorMessage ?? "Command failed"}: ${why}`,
      {
        exitCode: result.code,
        stderr: result.stderr,
        stdout: result.stdout,
        timedOut: result.timedOut,
      }
    );
  }
  return result;
}

/** Map a CommandFailedError to an AppError with a stable code. */
export function commandFailureToAppError(
  err: unknown,
  opts: { binary: "yt-dlp" | "ffmpeg"; timeoutCode?: "TIMEOUT"; notFoundCode?: "YTDLP_NOT_FOUND" }
): AppError {
  if (err instanceof CommandFailedError) {
    if (err.timedOut) return new AppError(opts.timeoutCode ?? "TIMEOUT");
    return new AppError(
      opts.binary === "yt-dlp" ? "YTDLP_ERROR" : "FFMPEG_ERROR",
      err.message
    );
  }
  if (isExecutableMissing(err)) {
    return new AppError(opts.notFoundCode ?? "FFMPEG_ERROR");
  }
  if (err instanceof AppError) return err;
  return new AppError("INTERNAL");
}