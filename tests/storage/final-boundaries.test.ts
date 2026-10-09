import { afterEach, expect, test } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture } from '../freshness/fixture.js';
import { cleanup } from '../project/helpers.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
const loader = `import {registerHooks} from 'node:module'; registerHooks({resolve(s,c,n){if(!c.parentURL?.includes('/node_modules/')&&s.startsWith('.')&&s.endsWith('.js'))s=s.slice(0,-3)+'.ts';return n(s,c)}});`;
async function child(code: string) {
  return new Promise<{ code: number | null; stdout: string; killed: boolean }>((done, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', loader + code], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let killed = false; proc.stdout.on('data', chunk => { stdout += chunk; });
    const timer = setTimeout(() => { killed = true; proc.kill('SIGKILL'); }, 2000);
    proc.on('error', reject); proc.on('exit', code => { clearTimeout(timer); done({ code, stdout, killed }); });
  });
}
for (const target of ['reference', 'network', 'config', 'inventory']) test.skipIf(process.platform === 'win32')(`static_FIFO_${target}_is_rejected_without_blocking`, async () => {
  const p = await fixture(roots); let path = join(p.root, 'source.ts');
  if (target === 'network') path = join(p.networkDir, 'alpha.yaml');
  if (target === 'config') { await mkdir(join(p.root, '.codex')); path = join(p.root, '.codex/config.toml'); }
  await rm(path, { force: true }); await promisify(execFile)('mkfifo', [path]);
  const code = `const {openProject}=await import('./src/project/root.ts'); const p=await openProject(${JSON.stringify(p.root)}); try { ${target === 'reference' ? "await (await import('./src/storage/repository.ts')).readReferenceHash(p,'source.ts',{});" : target === 'network' ? "await (await import('./src/storage/repository.ts')).readSnapshot(p);" : target === 'config' ? "await (await import('./src/adapters/setup.ts')).readSetupConfig('codex',p.root);" : "const result=await (await import('./src/bootstrap/inventory.ts')).inventory(p); if(!result.files.some(f=>f.path==='source.ts'&&f.status==='needs_review'))throw new Error('unclassified');"} process.stdout.write('completed'); }catch(e){process.stdout.write(e.code??e.message);}`;
  const result = await child(code); expect(result.killed).toBe(false); expect(result.code).toBe(0);
  expect(result.stdout).toBe(target === 'inventory' ? 'completed' : target === 'reference' ? 'unsafe_reference' : target === 'config' ? 'unsafe_config' : 'unsafe_path');
});
test('Windows_publication_skips_unsupported_directory_sync_but_flushes_regular_files', async () => {
  const p = await fixture(roots);
  const result = await child(`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; Object.defineProperty(process,'platform',{value:'win32'}); const orig=fs.promises.open; let files=0; let dirs=0; fs.promises.open=async(...args)=>{const h=await orig(...args);const sync=h.sync.bind(h); h.sync=async()=>{if((await h.stat()).isDirectory()){dirs++;throw new Error('unsupported-directory-sync');}files++;return sync();};return h;};syncBuiltinESMExports(); const {openProject}=await import('./src/project/root.ts');const p=await openProject(${JSON.stringify(p.root)});try{await (await import('./src/storage/runtime.ts')).writeRuntime(p,'probe',null,{ok:true});process.stdout.write(JSON.stringify({files,dirs}));}catch(e){process.stdout.write(e.message);}`);
  expect(result.killed).toBe(false); expect(JSON.parse(result.stdout).files).toBeGreaterThanOrEqual(1); expect(JSON.parse(result.stdout).dirs).toBe(0);
});

test.skipIf(process.platform === 'win32')('POSIX_parent_sync_IO_error_is_propagated', async()=>{
 const p=await fixture(roots);
 const result=await child(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const orig=fs.promises.open;fs.promises.open=async(...args)=>{const h=await orig(...args);const sync=h.sync.bind(h);h.sync=async()=>{if((await h.stat()).isDirectory())throw Object.assign(new Error('io-error'),{code:'EIO'});return sync();};return h;};syncBuiltinESMExports();const {openProject}=await import('./src/project/root.ts');const p=await openProject(${JSON.stringify(p.root)});try{await (await import('./src/storage/journal.ts')).atomicStorageWrite(p,'.feature-network/probe.json','{}');process.stdout.write('unexpected-success');}catch(e){process.stdout.write(e.code);}`);
 expect(result.stdout).toBe('EIO');expect(result.killed).toBe(false);
});

test('postpublication_cache_capture_EIO_does_not_fail_committed_runtime_write_or_hide_stale_CAS', async()=>{
 const p=await fixture(roots);
 const result=await child(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';let published=false;let injected=false;const rename=fs.promises.rename;const readdir=fs.promises.readdir;fs.promises.rename=async(...args)=>{await rename(...args);if(String(args[1]).replaceAll('\\\\','/').endsWith('/values/probe.json'))published=true;};fs.promises.readdir=async(...args)=>{if(published&&String(args[0]).replaceAll('\\\\','/').endsWith('/network-spec')){injected=true;throw Object.assign(new Error('injected-cache-capture'),{code:'EIO'});}return readdir(...args);};syncBuiltinESMExports();const {openProject}=await import('./src/project/root.ts');const {writeRuntime,readRuntime}=await import('./src/storage/runtime.ts');const p=await openProject(${JSON.stringify(p.root)});let outcome='resolved';try{await writeRuntime(p,'probe',null,{committed:true});}catch(e){outcome=e.code;}const saved=await readRuntime(p,'probe');let stale='unexpected-success';try{await writeRuntime(p,'probe',null,{committed:false});}catch(e){stale=e.code;}process.stdout.write(JSON.stringify({outcome,published,injected,saved,stale}));`);
 expect(result.killed).toBe(false);expect(result.code).toBe(0);
 expect(JSON.parse(result.stdout)).toEqual({outcome:'resolved',published:true,injected:true,saved:{committed:true},stale:'conflict'});
});

test('authoritative_runtime_publication_EIO_still_rejects_without_saved_value',async()=>{
 const p=await fixture(roots);
 const result=await child(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.promises.rename;fs.promises.rename=async(...args)=>{if(String(args[1]).replaceAll('\\\\','/').endsWith('/values/probe.json'))throw Object.assign(new Error('authoritative-write'),{code:'EIO'});return rename(...args);};syncBuiltinESMExports();const {openProject}=await import('./src/project/root.ts');const {writeRuntime,readRuntime}=await import('./src/storage/runtime.ts');const p=await openProject(${JSON.stringify(p.root)});let outcome='unexpected-success';try{await writeRuntime(p,'probe',null,{committed:true});}catch(e){outcome=e.code;}process.stdout.write(JSON.stringify({outcome,saved:await readRuntime(p,'probe')}));`);
 expect(result.killed).toBe(false);expect(result.code).toBe(0);expect(JSON.parse(result.stdout)).toEqual({outcome:'EIO',saved:null});
});
