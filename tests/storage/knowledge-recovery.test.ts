import { afterEach, expect, test } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { projectV2, testKnowledge } from '../helpers/connected.js';
import { cleanup } from '../project/helpers.js';
const api = await import('../../src/storage/documents.js').catch(() => null);
const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
test('pending_schema_two_journal_is_reported_on_read_and_completed_only_on_write', async () => {
  expect(api?.readProjectSnapshot).toBeTypeOf('function'); const f = await projectV2(roots,'A'); const a = api!;
  const before = await a.readProjectSnapshot(f.project,{sourceMode:'none'});
  const path = 'network-spec/knowledge/roles.yaml'; const text = JSON.stringify(testKnowledge());
  await mkdir(f.project.runtimeDir,{recursive:true});
  await writeFile(join(f.project.runtimeDir,'journal.json'),JSON.stringify({version:2,before:before.fingerprints,changes:{[path]:text}}));
  expect((await a.readProjectSnapshot(f.project,{sourceMode:'none'})).integrity).toBe('pending_recovery');
  await expect(readFile(join(f.root,path))).rejects.toMatchObject({code:'ENOENT'});
  await expect(a.commitNetworkDocuments(f.project,before.revision,{})).rejects.toMatchObject({code:'conflict'});
  expect((await a.readProjectSnapshot(f.project,{sourceMode:'none'})).knowledge[0]!.id).toBe('roles');
});
test('forged_nested_journal_path_cannot_escape_knowledge', async () => {
  expect(api?.readProjectSnapshot).toBeTypeOf('function'); const f = await projectV2(roots,'A'); const a = api!;
  const before = await a.readProjectSnapshot(f.project,{sourceMode:'none'});
  await mkdir(f.project.runtimeDir,{recursive:true});
  await writeFile(join(f.project.runtimeDir,'journal.json'),JSON.stringify({version:2,before:before.fingerprints,changes:{'network-spec/knowledge/../../source.ts':'overwrite'}}));
  await expect(a.commitNetworkDocuments(f.project,before.revision,{})).rejects.toMatchObject({code:'pending_recovery'});
});

test('sigkill_after_journal_publication_preserves_recoverable_knowledge', async () => {
  expect(api?.readProjectSnapshot).toBeTypeOf('function'); const f = await projectV2(roots,'A');
  const snap = await api!.readProjectSnapshot(f.project,{sourceMode:'none'});
  const file = join(f.root,'worker.mjs');
  await build({stdin:{contents:`
    import {openProject} from ${JSON.stringify(resolve('src/project/root.ts'))};
    import {applyDocumentUpdate} from ${JSON.stringify(resolve('src/storage/documents.ts'))};
    import {hasJournal} from ${JSON.stringify(resolve('src/storage/journal.ts'))};
    const project = await openProject(process.argv[2]);
    const request = JSON.parse(process.argv[3]);
    await applyDocumentUpdate(project,request,{beforePublish:async()=>{
      if(await hasJournal(project)){process.send('journal-ready'); await new Promise(()=>{});}
    }});
  `,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);"},outfile:file});
  const request = {expectedRevision:snap.revision,expected:{'network-spec/knowledge/roles.yaml':null},upserts:[testKnowledge()],deletes:[],sources:[]};
  const child = fork(file,[f.root,JSON.stringify(request)],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr = ''; child.stderr?.on('data',bytes=>{stderr += bytes.toString();});
  try {
    await Promise.race([once(child,'message'),once(child,'exit').then(([code])=>{throw new Error(`worker_exit_${code}: ${stderr}`);}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('worker_not_ready')),5000);timer.unref();})]);
    const closed = once(child,'exit'); child.kill('SIGKILL'); await closed;
    expect((await api!.readProjectSnapshot(f.project,{sourceMode:'none'})).integrity).toBe('pending_recovery');
    await expect(api!.commitNetworkDocuments(f.project,snap.revision,{})).rejects.toMatchObject({code:'conflict'});
    expect((await api!.readProjectSnapshot(f.project,{sourceMode:'none'})).knowledge[0]!.id).toBe('roles');
  } finally { child.kill(); }
},15000);
