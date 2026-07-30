import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** SSRF guard: http(s) only, block private/link-local — WITH DNS resolution before the check. */
const BLOCKED_HOST_RE = /^(localhost|.*\.local|.*\.internal)$/i;

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) { // IPv6
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
  }
  const p = ip.split(".").map(Number);
  return p[0] === 127 || p[0] === 10 || p[0] === 0 ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
}

export async function isUrlAllowed(raw: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  if (BLOCKED_HOST_RE.test(host)) return false;
  if (isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.every(a => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}
