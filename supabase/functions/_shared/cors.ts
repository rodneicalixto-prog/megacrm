// Shared CORS headers for every Edge Function in this app.
// Supabase Edge Functions don't add CORS by default; the browser needs these
// to talk to the function from the Vite dev server or production domain.
//
// Access-Control-Allow-Origin defaults to '*' (unchanged behavior) unless the
// APP_ORIGIN secret is set on this Supabase project (Edge Functions ->
// Settings -> Secrets, or `supabase secrets set APP_ORIGIN=https://yourapp.example`).
// This is deliberately opt-in and single-origin: this repo is self-hosted, so
// hardcoding any specific domain here would break every other installation.
// Auth on this app is bearer-token (not cookie), so the wildcard default does
// not expose authenticated routes to CSRF -- this only narrows the surface.

const configuredOrigin = Deno.env.get('APP_ORIGIN')?.trim();

export const corsHeaders = {
  'Access-Control-Allow-Origin': configuredOrigin || '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};

// CSP + security headers for responses (not preflights).
export const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    configuredOrigin ? `script-src 'self' ${configuredOrigin}` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...securityHeaders,
      ...(init.headers ?? {}),
    },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}
