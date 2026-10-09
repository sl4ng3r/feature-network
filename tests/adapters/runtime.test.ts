import { afterEach, expect, test } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../freshness/fixture.js';
import { cleanup } from '../project/helpers.js';
import { readSnapshot } from '../../src/storage/repository.js';
import { writeRuntime } from '../../src/storage/runtime.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
test('hook_runtime_write_rejects_journal_found_under_lock_without_recovery', async () => {
  const p = await fixture(roots); const snap = await readSnapshot(p);
  const journal = JSON.stringify({ version: 1, before: snap.fingerprints, changes: {} });
  await writeFile(join(p.runtimeDir, 'journal.json'), journal);
  await expect(writeRuntime(p, 'hooks/test', null, { value: 1 }, { allowRecovery: false })).rejects.toMatchObject({ code: 'pending_recovery' });
  expect(await readFile(join(p.runtimeDir, 'journal.json'), 'utf8')).toBe(journal);
});
test('journal_created_while_hook_waits_for_lock_is_not_recovered', async () => {
  const { withProjectLock } = await import('../../src/storage/lock.js');
  const p = await fixture(roots); const snap = await readSnapshot(p);
  const journal = JSON.stringify({ version: 1, before: snap.fingerprints, changes: {} });
  let pending!: Promise<unknown>;
  await withProjectLock(p, async () => {
    pending = writeRuntime(p, 'hooks/test', null, { value: 1 }, { allowRecovery: false }).catch(error => error);
    await writeFile(join(p.runtimeDir, 'journal.json'), journal);
  });
  expect(await pending).toMatchObject({ code: 'pending_recovery' });
  expect(await readFile(join(p.runtimeDir, 'journal.json'), 'utf8')).toBe(journal);
});
