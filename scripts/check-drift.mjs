// ============================================================================
// Detects the two failure classes found in production on 01/09/2026:
//   1. Migration drift — a migration applied to Supabase that has no matching
//      file in supabase/migrations/ (i.e. someone ran SQL directly, or a
//      branch with migrations was never merged into main).
//   2. RLS gaps — any whatsapp_hub.* table with row-level security disabled.
//
// Read-only. Exits 1 (fails CI) if either check finds something; exits 0
// otherwise. Uses the Supabase Management API with a PAT, same pattern as
// scripts/push-migrations.mjs — no DB password needed.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_... PROJECT_REF=abc node scripts/check-drift.mjs
// ============================================================================

import { readdirSync } from 'node:fs';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.PROJECT_REF;

if (!TOKEN || !REF) {
  console.error('Missing SUPABASE_ACCESS_TOKEN or PROJECT_REF env vars.');
  process.exit(2);
}

const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function runSql(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Query failed (${res.status}): ${body}`);
  return JSON.parse(body);
}

function localVersions() {
  const dir = 'supabase/migrations';
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.slice(0, f.indexOf('_'))),
  );
}

async function checkMigrationDrift() {
  const rows = await runSql(
    'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;',
  );
  const local = localVersions();
  const missing = rows.filter((r) => !local.has(r.version));

  if (missing.length === 0) {
    console.log(`OK — all ${rows.length} remote migrations have a local file.`);
    return true;
  }

  console.error(`DRIFT — ${missing.length} migration(s) applied to production with no file in supabase/migrations/:`);
  for (const m of missing) console.error(`  ${m.version}  ${m.name}`);
  console.error('These were likely applied directly, or live on an unmerged branch. See ISSUES.md.');
  return false;
}

async function checkRlsGaps() {
  const rows = await runSql(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'whatsapp_hub' AND c.relkind = 'r' AND c.relrowsecurity = false
    ORDER BY table_name;
  `);

  if (rows.length === 0) {
    console.log('OK — every whatsapp_hub table has RLS enabled.');
    return true;
  }

  console.error(`RLS GAP — ${rows.length} whatsapp_hub table(s) without row-level security:`);
  for (const r of rows) console.error(`  ${r.table_name}`);
  return false;
}

async function main() {
  const results = await Promise.all([checkMigrationDrift(), checkRlsGaps()]);
  if (results.every(Boolean)) {
    console.log('\nNo drift, no RLS gaps.');
    process.exit(0);
  }
  console.error('\nFAILED — see above.');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
