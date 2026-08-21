export type MigrationHistory = {
  applied: Set<string>;
  backfill: string[];
};

export function migrationVersion(file: string): string | null {
  return /^(\d+)_/.exec(file)?.[1] ?? null;
}

export function reconcileMigrationHistory(
  files: string[],
  checkpointSteps: string[],
  canonicalVersions: string[],
): MigrationHistory {
  const applied = new Set(checkpointSteps);
  const canonical = new Set(canonicalVersions);
  const backfill: string[] = [];

  for (const file of files) {
    const step = `migration:${file}`;
    const version = migrationVersion(file);
    if (!version || !canonical.has(version) || applied.has(step)) continue;
    applied.add(step);
    backfill.push(step);
  }

  return { applied, backfill };
}
