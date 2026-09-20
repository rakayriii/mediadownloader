import dns from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors";
import { MAX_URL_LENGTH } from "@/lib/config";

/**
 * URL validation and SSRF hardening.
 *
 * Safety rules (this app downloads only public media the user is authorized to
 * access — no DRM/private-content bypass):
 *  1. http/https only.
 *  2. No embedded credentials.
 *  3. No localhost / private / loopback / link-local / reserved IPs
 *     after DNS resolution (blocks SSRF against the host network).
 *  4. Hostname must be resolvable.
 */

export interface ValidationResult {
  ok: boolean;
  url?: string;
  error?: string;
  code?: string;
}

function parseUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new AppError("INVALID_URL", "URL is required");
  }
  const value = raw.trim();
  if (value.length > MAX_URL_LENGTH) {
    throw new AppError(
      "INVALID_URL",
      `URL exceeds the ${MAX_URL_LENGTH} character limit`
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError("INVALID_URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError("INVALID_URL", "Only http and https URLs are supported");
  }
  if (parsed.username || parsed.password) {
    throw new AppError(
      "INVALID_URL",
      "URLs with embedded credentials are not allowed"
    );
  }
  if (!parsed.hostname || parsed.hostname.length === 0) {
    throw new AppError("INVALID_URL");
  }
  if (/[\u0000-\u001f\u007f]/.test(parsed.hostname)) {
    throw new AppError("INVALID_URL", "Invalid hostname");
  }
  return parsed;
}

function inNetwork(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function ipv4ToInt(ip: string): number {
  const [a, b, c, d] = ip.split(".").map(Number);
  return ((((a << 24) | (b << 16) | (c << 8) | d) >>> 0));
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  const guards: Array<[string, number]> = [
    ["0.0.0.0", 8], // "this" network
    ["10.0.0.0", 8], // private
    ["100.64.0.0", 10], // CGNAT
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local
    ["172.16.0.0", 12], // private
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // TEST-NET-1
    ["192.88.99.0", 24], // 6to4 relay anycast
    ["192.168.0.0", 16], // private
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
  ];
  for (const [baseStr, bits] of guards) {
    if (inNetwork(value, ipv4ToInt(baseStr), bits)) return true;
  }
  if ((value & 0xf0000000) >>> 0 === 0xe0000000) return true; // 224.0.0.0/4 multicast
  if ((value & 0xf0000000) >>> 0 === 0xf0000000) return true; // 240.0.0.0/4 reserved
  if (value === 0xffffffff) return true; // broadcast
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("::ffff:")) {
    const embedded = lower.slice("::ffff:".length);
    if (isIP(embedded) === 4) {
      const v4 = embedded.split(".").map(Number).join(".");
      return isBlockedIpv4(v4);
    }
    return true;
  }
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("f") && lower.length > 1 && /^f[0-9a-f]/.test(lower)) {
    // multicast + reserved (ff00::/8 and beyond)
    return true;
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("2001:db8:")) return true; // documentation
  return false;
}

function isBlockedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "");
  const version = isIP(clean);
  if (version === 4) return isBlockedIpv4(clean);
  if (version === 6) return isBlockedIpv6(clean);
  return false;
}

/** Throws AppError when the URL is not acceptable; otherwise returns the URL. */
export async function assertValidUrl(
  raw: string,
  opts: { resolveDns?: boolean } = {}
): Promise<URL> {
  const parsed = parseUrl(raw);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  const literal = isIP(hostname);
  if (literal !== 0) {
    if (isBlockedIp(hostname)) throw new AppError("BLOCKED_URL");
    return parsed;
  }

  if (opts.resolveDns === false) return parsed;

  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const record of records) {
      if (isBlockedIp(record.address)) {
        throw new AppError("BLOCKED_URL");
      }
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("INVALID_URL", `Could not resolve host "${hostname}"`);
  }
  return parsed;
}

/**
 * Non-throwing validation used by batch flows and client pre-checks.
 */
export async function validateUrl(
  raw: string,
  opts: { resolveDns?: boolean } = {}
): Promise<ValidationResult> {
  try {
    const parsed = await assertValidUrl(raw, opts);
    return { ok: true, url: parsed.toString() };
  } catch (err) {
    if (err instanceof AppError) {
      return { ok: false, code: err.code, error: err.message };
    }
    return { ok: false, code: "INTERNAL", error: "Unexpected validation error" };
  }
}