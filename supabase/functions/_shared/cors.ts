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

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
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
