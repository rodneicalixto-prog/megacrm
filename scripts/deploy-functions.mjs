// ============================================================================
// Deploy every Edge Function in supabase/functions/ to the linked project.
// JWT verification is configured per function in supabase/config.toml.
// User-facing functions keep the platform verifier enabled. Only signed
// webhooks and intentionally public endpoints disable it.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_... PROJECT_REF=abc npm run functions:deploy
// ============================================================================

import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.PROJECT_REF;

if (!TOKEN || !REF) {
  console.error('Missing SUPABASE_ACCESS_TOKEN or PROJECT_REF env vars.');
  process.exit(2);
}

const dir = 'supabase/functions';
const entries = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)
  .sort();

console.log(`Deploying ${entries.length} Edge Functions to ${REF}...\n`);

function run(fn) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'supabase',
        'functions',
        'deploy',
        fn,
        '--project-ref',
        REF,
      ],
      {
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: TOKEN },
        stdio: 'inherit',
        shell: process.platform === 'win32',
      },
    );
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${fn} exited ${code}`))));
  });
}

for (const fn of entries) {
  console.log(`== ${fn} ==`);
  try {
    await run(fn);
  } catch (err) {
    console.error(`Failed to deploy ${fn}:`, err);
    process.exit(1);
  }
}

console.log(`\n✓ ${entries.length} functions deployed.`);
