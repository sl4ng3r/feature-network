import { describe, afterEach, expect, test, vi } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { openProject } from '../../src/project/root.js';
import { applyUpdate, readSnapshot } from '../../src/storage/repository.js';
import { withProjectLock } from '../../src/storage/lock.js';
import { cleanup, tree } from '../project/helpers.js';
import { feature, initial, refs, worker, type Worker } from '../helpers/storage-worker.js';

const roots: string[] = []; const workers: Worker[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const w of workers.splice(0)) { w.child.kill('SIGKILL'); await w.done; } await Promise.all(roots.splice(0).map(cleanup)); });
async function setup() { const root = await tree(); roots.push(root); await writeFile(join(root, 'source.ts'), 'source'); const p = await openProject(root); await applyUpdate(p, initial()); return p; }
const start = (...args: Parameters<typeof worker>) => { const w = worker(...args); workers.push(w); return w; };

// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
test('read_during_write_never_mixes_states', async () => {
  const p = await setup(); const before = await readSnapshot(p);
  const writer = start(p.root, 'update', { expected: before.fingerprints, upserts: [feature('alpha', 'New'), feature('beta', 'New')], deletes: [], verifiedReferences: refs }, 'after-rename');
  expect(await writer.next()).toEqual({ stage: 'after-rename' });
  const reader = start(p.root, 'read');
  writer.child.send('continue');
  const [write, read] = await Promise.all([writer.next(), reader.next()]);
  expect(write.error).toBeUndefined();
  expect(read.result.integrity).toBe('valid');
  expect(read.result.features.map((f: any) => f.summary)).toEqual(['New', 'New']);
  expect((await reader.done).stderr).toBe('');
});
test('competing_process_writers_do_not_lose_updates', async () => {
  const p = await setup(); const snap = await readSnapshot(p);
  const update = (summary: string) => ({ expected: snap.fingerprints, upserts: [feature('alpha', summary)], deletes: [], verifiedReferences: refs });
  const a = start(p.root, 'update', update('Writer A')); const b = start(p.root, 'update', update('Writer B'));
  const results = await Promise.all([a.next(), b.next()]);
  expect(results.filter(r => r.result)).toHaveLength(1);
  expect(results.filter(r => r.error?.code === 'conflict')).toHaveLength(1);
  expect(['Writer A', 'Writer B']).toContain((await readSnapshot(p)).features[0]?.summary);
});
test('dead_owner_reclaimed_unknown_owner_not_removed', async () => {
  const p = await setup(); const lock = start(p.root, 'lock');
  expect(await lock.next()).toEqual({ stage: 'locked' });
  lock.child.kill('SIGKILL'); await lock.done;
  expect((await readSnapshot(p)).integrity).toBe('valid');
  const unknownOwner = JSON.stringify({ version: 1, pid: process.pid, hostname: `${hostname()}-unknown`, token: 'unknown' });
  await writeFile(join(p.runtimeDir, 'lock'), unknownOwner);
  await expect(readSnapshot(p)).rejects.toMatchObject({ code: 'lock_busy' });
  const { readFile } = await import('node:fs/promises');
  const retainedOwner = await readFile(join(p.runtimeDir, 'lock'), 'utf8');
  expect(retainedOwner).toBe(unknownOwner);
  expect(JSON.parse(retainedOwner).token).toBe('unknown');
}, 6000);

test('unknown_owner_acquisition_stops_at_two_second_deadline_without_running_action', async () => {
  const p = await setup();
  const ownerPath = join(p.runtimeDir, 'lock');
  const owner = JSON.stringify({ version: 1, pid: process.pid, hostname: `${hostname()}-unknown`, token: 'unknown' });
  await writeFile(ownerPath, owner);
  const action = vi.fn(async () => 'must not run');
  // Test the acquisition budget independently of filesystem and scheduler latency.
  const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(2001);
  try {
    await expect(withProjectLock(p, action)).rejects.toMatchObject({ code: 'lock_busy' });
    expect(action).not.toHaveBeenCalled();
    expect(clock).toHaveBeenCalledTimes(2);
    expect(await readFile(ownerPath, 'utf8')).toBe(owner);
  } finally { clock.mockRestore(); }
}, 6000);

for (const phase of ['external-once', 'external-repeat']) {
  test(`snapshot_retries_are_bounded_${phase}`, async () => {
    const p = await setup(); const path = join(p.networkDir, 'alpha.yaml');
    const content = await readFile(path, 'utf8');
    const reader = start(p.root, 'read', {}, phase);
    for (let i = 0; i < (phase === 'external-once' ? 1 : 3); i++) {
      expect(await reader.next()).toEqual({ stage: 'captured' });
      await writeFile(path, content.replace('summary: Old', `summary: External ${i}`));
      reader.child.send('continue');
    }
    const result = await reader.next();
    if (phase === 'external-once') expect(result.result.features[0].summary).toBe('External 0');
    else expect(result.error.code).toBe('conflict');
    expect((await reader.done).code).toBe(0);
  });
}

test('competing_dead_owner_reapers_do_not_unlink_the_successor_lock', async () => {
  const p = await setup(); const snap = await readSnapshot(p);
  const held = start(p.root, 'lock'); expect(await held.next()).toEqual({ stage: 'locked' });
  held.child.kill('SIGKILL'); await held.done;
  const writers = ['A', 'B', 'C'].map(summary => start(p.root, 'update', { expected: snap.fingerprints, upserts: [feature('alpha', summary)], deletes: [], verifiedReferences: refs }));
  const outcomes = await Promise.all(writers.map(w => w.next()));
  expect(outcomes.filter(r => r.result)).toHaveLength(1);
  expect(outcomes.filter(r => r.error?.code === 'conflict')).toHaveLength(2);
  expect((await readSnapshot(p)).integrity).toBe('valid');
});

test('incomplete_owner_identity_is_never_reclaimed', async () => {
  const p = await setup();
  const dead = start(p.root, 'read'); await dead.next(); await dead.done;
  await writeFile(join(p.runtimeDir, 'lock'), JSON.stringify({ version: 1, pid: dead.child.pid, hostname: hostname() }));
  await expect(readSnapshot(p)).rejects.toMatchObject({ code: 'lock_busy' });
  expect(JSON.parse(await readFile(join(p.runtimeDir, 'lock'), 'utf8')).pid).toBe(dead.child.pid);
}, 6000);

});
