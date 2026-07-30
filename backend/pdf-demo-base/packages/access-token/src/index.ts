/** Demo access token (KV + TTL). NOT OAuth — just gates the demo itself. */
export interface TokenInfo { token: string; expiresAt: number }

export async function issueToken(kv: KVNamespace, ttlSeconds: number): Promise<TokenInfo> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = Date.now() + ttlSeconds * 1000;
  await kv.put(`tok:${token}`, String(expiresAt), { expirationTtl: ttlSeconds });
  return { token, expiresAt };
}

export async function checkToken(kv: KVNamespace, token: string | null): Promise<{ valid: boolean; expiresAt?: number }> {
  if (!token) return { valid: false };
  const v = await kv.get(`tok:${token}`);
  if (!v) return { valid: false };
  return { valid: true, expiresAt: Number(v) };
}
