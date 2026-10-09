import { afterEach, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { cp, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanup, exec, tree } from '../project/helpers.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
async function files(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) paths.push(...(await files(join(directory, entry.name))).map(path => entry.name + '/' + path));
    else paths.push(entry.name);
  }
  return paths.sort();
}
test('paused_build_temporary_write_is_not_visible_to_real_offline_package_copy', async () => {
  const temp = await tree(); roots.push(temp);
  // Instrument only this test child, after the real write and before atomic publication.
  const boot = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; import {once} from 'node:events';
const write = fs.promises.writeFile; let paused = false;
fs.promises.writeFile = async (...args) => {
  const result = await write(...args); const path = String(args[0]);
  if (!paused && (path.includes('.feature-network-build-') || /\\.tmp-\\d+$/.test(path))) {
    paused = true; process.send({temporaryWritten:path}); await once(process, 'message');
  }
  return result;
}; syncBuiltinESMExports();
await import(${JSON.stringify(pathToFileURL(resolve('scripts/build-plugin.mjs')).href)}); process.disconnect();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', boot], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr!.on('data', bytes => { stderr += bytes; });
  const done = new Promise<number | null>(resolveDone => child.on('close', resolveDone));
  try {
    const boundary = await new Promise<{ temporaryWritten: string }>((resolveBoundary, reject) => {
      child.once('message', message => resolveBoundary(message as { temporaryWritten: string }));
      child.once('error', reject); child.once('exit', () => reject(new Error('build exited before instrumented boundary: ' + stderr)));
    });
    expect(boundary.temporaryWritten).toBeTruthy();
    const baseline = (await files(resolve('plugin'))).filter(path => !/\.tmp-\d+$/.test(path));
    const installed = join(temp, 'offline-plugin'); await cp(resolve('plugin'), installed, { recursive: true });
    expect(await files(installed)).toEqual(baseline);
  } finally { if (child.connected) child.send('resume'); expect(await done).toBe(0); expect(stderr).toBe(''); }
}, 20000);
