import { afterEach, expect, test, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { readSnapshot } from '../../src/storage/repository.js';
import { isIgnoredChange } from '../../src/freshness/references.js';
import { handleCodexEvent } from '../../src/adapters/codex.js';
import { inventory } from '../../src/bootstrap/inventory.js';
import { fixture } from '../freshness/fixture.js';
import { cleanup, tree } from './helpers.js';

// Files and Git are real. Only the path-library boundary models the Windows
// runner topology: plugin on D:, synthetic checkout in C: TEMP. Native Windows
// CI exercises this topology without the characterization seam.
const topology = vi.hoisted(() => ({ pluginRoot: '' }));
vi.mock('node:path', async importOriginal => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    relative: (from: string, to: string) => topology.pluginRoot && from === topology.pluginRoot && to !== from && !to.startsWith(from + actual.sep)
      ? actual.win32.relative('D:\\installed-plugin', 'C:\\project\\source.ts') : actual.relative(from, to),
    isAbsolute: (path: string) => actual.isAbsolute(path) || actual.win32.isAbsolute(path),
  };
});
const roots: string[] = [];
afterEach(async () => { topology.pluginRoot = ''; await Promise.all(roots.splice(0).map(cleanup)); });
async function setup() {
  const project = await fixture(roots);
  const installation = await tree(); roots.push(installation);
  topology.pluginRoot = join(installation, 'installed-plugin');
  await mkdir(topology.pluginRoot);
  return { project, options: { excludedReferenceRoots: [topology.pluginRoot] } };
}

test('cross_volume_absolute_relative_result_preserves_source_snapshot_and_current_change', async () => {
  expect(win32.relative('D:\\installed-plugin', 'C:\\project\\source.ts')).toBe('C:\\project\\source.ts');
  const { project, options } = await setup();
  expect((await readSnapshot(project, options)).integrity).toBe('valid');
  expect(await isIgnoredChange(project, 'source.ts', options)).toBe(false);
  expect((await inventory(project, options)).files.find(file => file.path === 'source.ts')?.status).toBe('pending');
});

test('cross_volume_plugin_installation_captures_and_continues_actual_source_turn', async () => {
  const { project } = await setup();
  const event = { cwd: project.root, session_id: 'synthetic-volume-session', turn_id: 'synthetic-volume-turn' };
  const trusted = { pluginRoot: topology.pluginRoot };
  const started = await handleCodexEvent({ ...event, hook_event_name: 'UserPromptSubmit', prompt: '/feature-network-sync' }, trusted);
  expect(started.hookSpecificOutput).toBeDefined();
  await writeFile(join(project.root, 'source.ts'), 'changed source');
  const stopped = await handleCodexEvent({ ...event, hook_event_name: 'Stop', stop_hook_active: false }, trusted);
  expect(stopped.decision).toBe('block');
});
