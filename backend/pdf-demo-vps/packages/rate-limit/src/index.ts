import type { KVLike } from "@demo/access-token";
/** Counters over KVLike: per-token/hour, per-IP/hour, global emails/day. */
export interface LimitCheck { allowed: boolean; remaining: number; resetsInSeconds: number }

async function bump(kv: KVLike, key: string, limit: number, windowSeconds: number): Promise<LimitCheck> {
  const now = Math.floor(Date.now() / 1000);
  const windowId = Math.floor(now / windowSeconds);
  const k = `${key}:${windowId}`;
  const cur = Number((await kv.get(k)) ?? "0");
  const resetsInSeconds = (windowId + 1) * windowSeconds - now;
  if (cur >= limit) return { allowed: false, remaining: 0, resetsInSeconds };
  await kv.put(k, String(cur + 1), { expirationTtl: windowSeconds + 60 });
  return { allowed: true, remaining: limit - cur - 1, resetsInSeconds };
}

export const perToken = (kv: KVLike, token: string, limit: number) => bump(kv, `rl:t:${token}`, limit, 3600);
export const perIp = (kv: KVLike, ip: string, limit: number) => bump(kv, `rl:ip:${ip}`, limit, 3600);
export const emailsPerDay = (kv: KVLike, limit: number) => bump(kv, "rl:mail", limit, 86400);
