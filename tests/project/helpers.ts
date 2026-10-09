import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const exec = promisify(execFile);
export async function tree(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'Feature net Ü nicode '));
}
export const cleanup = (root: string): Promise<void> => rm(root, { recursive: true, force: true });
export async function marker(root: string, content = 'schema: 1\ncoverage: partial\n'): Promise<void> {
  await mkdir(join(root, 'network-spec'), { recursive: true });
  await writeFile(join(root, 'network-spec/_meta.yaml'), content);
}
export async function repo(root: string): Promise<void> {
  await exec('git', ['init', '-q', root]);
  await exec('git', ['-C', root, 'config', 'user.email', 'tests@example.invalid']);
  await exec('git', ['-C', root, 'config', 'user.name', 'Feature Network Tests']);
}
