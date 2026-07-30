/** SSRF guard for the image proxy: http(s) only, block private/link-local hosts. */
const BLOCKED_HOST_RE = /^(localhost|.*\.local|.*\.internal)$/i;
const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|f[cd][0-9a-f]{2}:)/i;

export function isUrlAllowed(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  if (BLOCKED_HOST_RE.test(host)) return false;
  if (PRIVATE_IP_RE.test(host)) return false;
  return true;
}
