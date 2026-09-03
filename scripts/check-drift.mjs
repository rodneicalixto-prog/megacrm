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

// Migrations aplicadas em produção que nunca vão ter arquivo em
// supabase/migrations/ — documentadas em ISSUES.md, não são drift real:
//   - fix_handle_new_user_hierarchy_aware / remediate_users_affected_by_old_trigger:
//     fix de dado pontual (UPDATE em app_users pra 4 usuários afetados) +
//     restauração de function pro texto que o repo já tinha. Não recriável
//     numa migration de forma que faça sentido (instância nova nunca teve o bug).
//   - lock_down_unprotected_public_tables: ENABLE RLS + REVOKE em tabelas do
//     schema "Tomik CRM" (public.*), um sistema alheio ao whatsapp_hub que
//     mora no mesmo projeto Supabase. Não é schema deste repositório.
const KNOWN_EXCEPTIONS = new Set([
  'fix_handle_new_user_hierarchy_aware',
  'remediate_users_affected_by_old_trigger',
  'lock_down_unprotected_public_tables',
]);

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

// slugOf('20260821150000_rls_legacy_tenant_tables.sql') -> 'rls_legacy_tenant_tables'
// slugOf('20260821150000_rls_legacy_tenant_tables')     -> 'rls_legacy_tenant_tables'
// slugOf('rls_legacy_tenant_tables')                    -> 'rls_legacy_tenant_tables' (sem prefixo pra tirar)
function slugOf(stem) {
  const withoutExt = stem.endsWith('.sql') ? stem.slice(0, -4) : stem;
  const underscoreIdx = withoutExt.indexOf('_');
  const looksLikeTimestamp = underscoreIdx > 0 && /^\d+$/.test(withoutExt.slice(0, underscoreIdx));
  return looksLikeTimestamp ? withoutExt.slice(underscoreIdx + 1) : withoutExt;
}

function localMigrations() {
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'));
  return {
    versions: new Set(files.map((f) => f.slice(0, f.indexOf('_')))),
    stems: new Set(files.map((f) => f.slice(0, -4))),
    slugs: new Set(files.map((f) => slugOf(f))),
  };
}

// O Supabase registra `version` como o timestamp de QUANDO a migration foi
// aplicada (via push-migrations.mjs, usando a Management API em vez de
// `supabase db push`), que pode divergir do timestamp no nome do arquivo —
// mas o `name` que ele devolve junto sempre corresponde ao arquivo real.
// Comparar só por `version` (como antes) gera falso positivo pra toda
// migration aplicada assim. Aceita match por version OU por name (como stem
// completo ou como slug, com ou sem timestamp próprio).
function isKnownLocally(row, local) {
  return (
    local.versions.has(row.version) ||
    local.stems.has(row.name) ||
    local.slugs.has(row.name) ||
    local.slugs.has(slugOf(row.name))
  );
}

async function checkMigrationDrift() {
  const rows = await runSql(
    'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;',
  );
  const local = localMigrations();
  const unmatched = rows.filter((r) => !isKnownLocally(r, local));
  const missing = unmatched.filter((r) => !KNOWN_EXCEPTIONS.has(r.name));
  const exceptions = unmatched.filter((r) => KNOWN_EXCEPTIONS.has(r.name));

  if (exceptions.length > 0) {
    console.log(`INFO — ${exceptions.length} migration(s) applied to production with no local file, but documented as an expected exception in ISSUES.md:`);
    for (const m of exceptions) console.log(`  ${m.version}  ${m.name}`);
  }

  if (missing.length === 0) {
    console.log(`OK — all ${rows.length} remote migrations are accounted for (local file or documented exception).`);
    return true;
  }

  console.error(`DRIFT — ${missing.length} migration(s) applied to production with no file in supabase/migrations/ and no documented exception:`);
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
