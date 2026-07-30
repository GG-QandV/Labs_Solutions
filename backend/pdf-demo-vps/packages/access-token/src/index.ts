/** Demo access token (TTL). Storage-agnostic: works over any KVLike (SQLite on VPS, KV on Cloudflare). */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface TokenInfo { token: string; expiresAt: number }

export async function issueToken(kv: KVLike, ttlSeconds: number): Promise<TokenInfo> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = Date.now() + ttlSeconds * 1000;
  await kv.put(`tok:${token}`, String(expiresAt), { expirationTtl: ttlSeconds });
  return { token, expiresAt };
}

export async function checkToken(kv: KVLike, token: string | null): Promise<{ valid: boolean; expiresAt?: number }> {
  if (!token) return { valid: false };
  const v = await kv.get(`tok:${token}`);
  if (!v) return { valid: false };
  return { valid: true, expiresAt: Number(v) };
}
