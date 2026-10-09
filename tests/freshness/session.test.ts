import { describe, afterEach, expect, test } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTurn } from '../../src/freshness/session.js';
import { checkNetwork } from '../../src/freshness/check.js';
import { cleanup, exec } from '../project/helpers.js';
import { commit, fixture } from './fixture.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
test('committed_mid_turn_is_still_changed', async () => {
  const p = await fixture(roots); await startTurn(p, 's');
  await writeFile(join(p.root, 'new.ts'), 'new'); await writeFile(join(p.root, 'source.ts'), 'changed'); await commit(p.root);
  const result = await checkNetwork(p, 'full', 's');
  expect(result.turnChanges).toEqual(['new.ts', 'source.ts']); expect(result.unknownChanges).toEqual(['new.ts']);
});
test('preexisting_edits_are_separate_and_further_edits_are_current', async () => {
  const p = await fixture(roots); await writeFile(join(p.root, 'old.ts'), 'preexisting'); await writeFile(join(p.root, 'source.ts'), 'preexisting');
  const turn = await startTurn(p, 's'); expect(turn.preexistingChanges).toEqual(['old.ts', 'source.ts']);
  await writeFile(join(p.root, 'new.ts'), 'new'); await writeFile(join(p.root, 'source.ts'), 'further change');
  const result = await checkNetwork(p, 'full', 's');
  expect(result.preexistingChanges).toEqual(['old.ts', 'source.ts']); expect(result.turnChanges).toEqual(['new.ts', 'source.ts']);
});
test('branch_switch_invalidates_turn_assumptions_even_at_same_head', async () => {
  const p = await fixture(roots); await startTurn(p, 's'); await exec('git', ['-C', p.root, 'switch', '-qc', 'other']);
  const result = await checkNetwork(p, 'full', 's');
  expect(result.turnAssumptions).toBe('invalidated'); expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'branch_changed' }));
});
test('repeated_start_creates_a_new_turn_and_arbitrary_session_ids_are_confined', async () => {
  const p = await fixture(roots); const first = await startTurn(p, '../s / ü'); await writeFile(join(p.root, 'source.ts'), 'before next');
  const next = await startTurn(p, '../s / ü'); expect(next.turnId).not.toBe(first.turnId); expect(next.preexistingChanges).toEqual(['source.ts']);
  expect((await checkNetwork(p, 'full', '../s / ü')).turnChanges).toEqual([]);
});

});
