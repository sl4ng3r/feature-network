import { afterEach, expect, test } from 'vitest';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanup, exec, repo, tree } from '../project/helpers.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });

test('autocrlf_checkout_keeps_committed_skill_bytes_and_binary_bytes', async () => {
  const root = await tree(); roots.push(root); await repo(root);
  await exec('git', ['-C', root, 'config', 'core.autocrlf', 'false']);
  // Copy the real delivery policy when present; its absence must expose the
  // Windows default conversion rather than making this fixture skip itself.
  await cp(resolve('.gitattributes'), join(root, '.gitattributes')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  const skill = await readFile(resolve('plugin/skills/feature-network-init/SKILL.md'));
  const binary = Buffer.from([0, 10, 255, 13, 10, 0]);
  await mkdir(join(root, 'plugin/skills/feature-network-init'), { recursive: true });
  await writeFile(join(root, 'plugin/skills/feature-network-init/SKILL.md'), skill);
  await writeFile(join(root, 'binary.dat'), binary);
  await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-qm', 'line ending fixture']);
  await exec('git', ['-C', root, 'config', 'core.autocrlf', 'true']);
  // Force actual materialization from the index rather than an up-to-date
  // worktree shortcut after changing core.autocrlf.
  await rm(join(root, 'plugin/skills/feature-network-init/SKILL.md'));
  await rm(join(root, 'binary.dat'));
  await exec('git', ['-C', root, 'checkout-index', '--force', '--all']);
  expect(await readFile(join(root, 'plugin/skills/feature-network-init/SKILL.md'))).toEqual(skill);
  expect(await readFile(join(root, 'binary.dat'))).toEqual(binary);
  expect((await exec('git', ['-C', root, 'status', '--short'])).stdout).toBe('');
}, 20000);
