import { describe, expect, test } from 'vitest';
import {
  migrationVersion,
  reconcileMigrationHistory,
} from '../../api/migration-history.ts';

const files = [
  '20260422120001_init.sql',
  '20260430120001_drop_super_admin.sql',
  '20260811130000_connection_delete_restrict.sql',
];

describe('migration history reconciliation', () => {
  test('extracts the canonical migration version from a filename', () => {
    expect(migrationVersion(files[0])).toBe('20260422120001');
    expect(migrationVersion('invalid.sql')).toBeNull();
  });

  test('imports canonical history when bootstrap checkpoints are missing', () => {
    const history = reconcileMigrationHistory(
      files,
      [],
      ['20260422120001', '20260430120001', '20260811130000'],
    );

    expect(history.backfill).toEqual(files.map((file) => `migration:${file}`));
    expect(history.applied).toEqual(new Set(history.backfill));
  });

  test('keeps fresh and partially applied migrations pending', () => {
    const existing = `migration:${files[0]}`;
    const history = reconcileMigrationHistory(files, [existing], ['20260430120001']);

    expect(history.backfill).toEqual([`migration:${files[1]}`]);
    expect(history.applied.has(existing)).toBe(true);
    expect(history.applied.has(`migration:${files[2]}`)).toBe(false);
  });
});
