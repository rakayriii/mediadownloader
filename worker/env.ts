import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal, dependency-free .env loader for the standalone worker.
 *
 * Next.js loads .env / .env.local automatically for the app; the worker is a
 * plain Node process, so it loads the same files itself. Real environment
 * variables always win (never overridden).
 */
export function loadLocalEnv(): void {
  for (const file of [".env", ".env.local"]) {
    const abs = join(process.cwd(), file);
    if (!existsSync(abs)) continue;
    try {
      const content = readFileSync(abs, "utf8");
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        if (!key) continue;
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {
      // ignore unreadable env files
    }
  }
}