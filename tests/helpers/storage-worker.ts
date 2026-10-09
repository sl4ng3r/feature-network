import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import type { Feature } from '../../src/model/types.js';

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const feature = (id = 'alpha', summary = 'Old'): Feature => ({ schema: 1, id, summary, key_points: [], code: [{ path: 'source.ts' }], evidence: [], relations: [], hypotheses: [] });
export const refs = [{ path: 'source.ts', hash: hash('source') }];
export const initial = () => ({ expected: { 'network-spec/_meta.yaml': null, 'network-spec/alpha.yaml': null, 'network-spec/beta.yaml': null }, upserts: [feature(), feature('beta')], deletes: [], verifiedReferences: refs, initialize: true });

export interface Worker {
  child: ChildProcess;
  next(): Promise<any>;
  done: Promise<{ code: number | null; signal: string | null; stderr: string }>;
}
export function worker(root: string, mode: string, payload: unknown = {}, phase = ''): Worker {
  // Node 24 strips TS; this test-only loader maps the source's build-time .js imports.
  const boot = `import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){if(!c.parentURL?.includes('/node_modules/')&&s.startsWith('.')&&s.endsWith('.js'))s=s.slice(0,-3)+'.ts';return n(s,c)}});
const {runWorker}=await import(${JSON.stringify(import.meta.url)}); await runWorker();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', boot], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, STORAGE_ROOT: root, STORAGE_MODE: mode, STORAGE_PAYLOAD: JSON.stringify(payload), STORAGE_PHASE: phase },
  });
  const queued: any[] = []; const waiting: Array<(value: any) => void> = [];
  child.on('exit', (code, signal) => { for (const resolve of waiting.splice(0)) resolve({ workerExit: { code, signal, stderr } }); });
  child.on('message', value => { const resolve = waiting.shift(); if (resolve) resolve(value); else queued.push(value); });
  let stderr = ''; child.stderr!.on('data', chunk => { stderr += chunk.toString(); });
  const done = new Promise<{ code: number | null; signal: string | null; stderr: string }>(resolve => child.on('exit', (code, signal) => resolve({ code, signal, stderr })));
  return { child, next: () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => waiting.push(resolve)), done };
}
export async function runWorker(): Promise<void> {
  const root = process.env.STORAGE_ROOT!;
  const phase = process.env.STORAGE_PHASE;
  const pause = async (stage: string) => { process.send!({ stage }); await once(process, 'message'); };
  const originalRename = fs.promises.rename;
  let intercepted = false;
  fs.promises.rename = async (source, destination) => {
    const target = String(destination).replaceAll('\\', '/');
    const match = !intercepted && ((phase === 'before-baseline' && target.endsWith('/baselines.json'))
      || (['before-rename', 'after-rename'].includes(phase!) && target.includes('/network-spec/')));
    if (match) { intercepted = true; if (phase !== 'after-rename') await pause(phase!); }
    await originalRename(source, destination);
    if (match && phase === 'after-rename') await pause(phase);
  };
  const originalReaddir = fs.promises.readdir;
  let captures = 0;
  fs.promises.readdir = (async (...args: Parameters<typeof fs.promises.readdir>) => {
    const names = await originalReaddir(...args);
    if (String(args[0]).replaceAll('\\', '/').endsWith('/network-spec') && phase?.startsWith('external-')) {
      captures++;
      // Pause between the two captures, independent of cold/cache read details.
      if ((phase === 'external-once' && captures === 2)
        || (phase === 'external-repeat' && captures % 2 === 0 && captures <= 6)) await pause('captured');
    }
    return names;
  }) as typeof fs.promises.readdir;
  syncBuiltinESMExports();
  const { openProject } = await import('../../src/project/root.js');
  const { applyUpdate, readSnapshot } = await import('../../src/storage/repository.js');
  const project = await openProject(root);
  try {
    const mode = process.env.STORAGE_MODE;
    if (mode === 'lock') {
      const { withProjectLock } = await import('../../src/storage/lock.js');
      await withProjectLock(project, () => pause('locked'));
      process.send!({ okay: true });
    } else if (mode === 'read') process.send!({ result: await readSnapshot(project) });
    else {
      let request = JSON.parse(process.env.STORAGE_PAYLOAD!);
      if (mode === 'file-update') request = JSON.parse(await fs.promises.readFile(request.requestPath, 'utf8'));
      process.send!({ result: await applyUpdate(project, request) });
    }
  } catch (error) { process.send!({ error: { code: (error as any).code, message: (error as Error).message } }); }
  process.disconnect!();
}
