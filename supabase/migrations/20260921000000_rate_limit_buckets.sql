-- Rate limiting table for webhooks and high-traffic endpoints
-- Tracks request counts per identifier (IP, phone, tenant, etc.)
-- Postgres job expires old entries hourly

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER DEFAULT 1 NOT NULL,
  limit_amount INTEGER NOT NULL,
  window_seconds INTEGER NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_rate_limit_buckets_expires ON public.rate_limit_buckets(expires_at);

-- RPC function for atomic rate limit check + increment
CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER,
  p_now TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (count INTEGER, allowed BOOLEAN) AS $$
DECLARE
  v_count INTEGER;
  v_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
  v_expires_at := p_now + (p_window_seconds || ' seconds')::INTERVAL;

  -- Try to insert (first request in window)
  INSERT INTO public.rate_limit_buckets (key, count, limit_amount, window_seconds, expires_at)
  VALUES (p_key, 1, p_limit, p_window_seconds, v_expires_at)
  ON CONFLICT (key) DO UPDATE
    SET
      count = CASE
        WHEN rate_limit_buckets.expires_at > p_now THEN rate_limit_buckets.count + 1
        ELSE 1
      END,
      expires_at = GREATEST(rate_limit_buckets.expires_at, v_expires_at)
  RETURNING rate_limit_buckets.count INTO v_count;

  -- Return count and whether it's allowed
  RETURN QUERY SELECT v_count, (v_count <= p_limit);
END;
$$ LANGUAGE plpgsql;

-- Grant RPC access
GRANT EXECUTE ON FUNCTION public.bump_rate_limit TO anon, authenticated, service_role;

-- Cleanup job: delete expired entries (runs hourly via pg_cron if installed)
-- If pg_cron is not available, add manual cleanup in migrations or via scheduled task
-- SELECT cron.schedule('rate-limit-cleanup', '0 * * * *', 'DELETE FROM public.rate_limit_buckets WHERE expires_at < NOW()');
