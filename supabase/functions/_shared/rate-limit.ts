// Rate limiting helper for webhooks and high-traffic endpoints.
// Uses Supabase replication lag as a "database": stores request counts
// in a dedicated table with TTL via Postgres job.

import { getAdminClient } from './supabase-admin.ts';

interface RateLimitConfig {
  maxRequests: number; // max requests per window
  windowSeconds: number; // time window in seconds
  keyPrefix: string; // e.g. 'whatsapp-inbound' to avoid collisions
}

/**
 * Check if a request is within rate limits.
 * Returns { allowed: boolean, remaining: number, retryAfter: number | null }
 */
export async function checkRateLimit(
  identifier: string, // e.g. phone number, IP, tenant ID
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; retryAfter: number | null }> {
  const admin = getAdminClient();
  const key = `${config.keyPrefix}:${identifier}`;
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.windowSeconds * 1000);

  try {
    // Increment counter atomically
    const { data, error } = await admin.rpc('bump_rate_limit', {
      p_key: key,
      p_limit: config.maxRequests,
      p_window_seconds: config.windowSeconds,
      p_now: now.toISOString(),
    });

    if (error) throw error;

    const count = (data as { count: number; allowed: boolean })?.count ?? 0;
    const allowed = (data as { count: number; allowed: boolean })?.allowed ?? false;
    const remaining = Math.max(0, config.maxRequests - count);
    const retryAfter = allowed ? null : config.windowSeconds;

    return { allowed, remaining, retryAfter };
  } catch (err) {
    // On error, allow the request but log for monitoring
    console.error(`[rate-limit] check failed for ${key}:`, err);
    return { allowed: true, remaining: config.maxRequests, retryAfter: null };
  }
}

/**
 * Reset rate limit for a specific identifier (admin cleanup).
 */
export async function resetRateLimit(
  identifier: string,
  keyPrefix: string,
): Promise<void> {
  const admin = getAdminClient();
  const key = `${keyPrefix}:${identifier}`;
  await admin.from('rate_limit_buckets').delete().eq('key', key);
}
