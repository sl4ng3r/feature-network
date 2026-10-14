import { afterEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture } from '../freshness/fixture.js';
import { cleanup, exec } from './helpers.js';
import { readProjectSnapshot } from '../../src/storage/documents.js';
const api = await import('../../src/project/upgrade.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
function upgrade(){expect(api?.planUpgrade).toBeTypeOf('function');return api!;}
test('upgrade_preserves_v1_content_and_second_apply_is_noop',async()=>{
  const p=await fixture(roots);const a=upgrade();const identity={id:randomUUID(),name:'Demo'};
  const plan=await a.planUpgrade(p,identity);await a.applyUpgrade(plan);
  const after=await readProjectSnapshot(p,{sourceMode:'none'});expect(after.meta).toMatchObject({schema:2,project:identity});expect(after.features[0]).toMatchObject({id:'alpha',summary:'Source',code:[{path:'source.ts'}]});
  const again=await a.planUpgrade(p,identity);expect(again.files).toEqual([]);expect((await a.applyUpgrade(again)).revision).toBe(after.revision);
  await expect(access(join(p.runtimeDir,'connections.yaml'))).rejects.toMatchObject({code:'ENOENT'});
});
test('upgrade_receipt_binds_identity_checkout_and_source_content',async()=>{
  const p=await fixture(roots);const a=upgrade();const identity={id:randomUUID(),name:'Demo'};const plan=await a.planUpgrade(p,identity);
  await expect(a.applyUpgrade({...plan})).rejects.toMatchObject({code:'invalid_upgrade'});
  await expect(a.applyApprovedUpgrade(p,{...identity,id:randomUUID()},plan.receipt)).rejects.toMatchObject({code:'conflict'});
  await writeFile(join(p.root,'source.ts'),'changed source');
  await expect(a.applyUpgrade(plan)).rejects.toMatchObject({code:'conflict'});
  expect((await readProjectSnapshot(p,{sourceMode:'none'})).meta?.schema).toBe(1);
});
test('upgrade_rejects_manual_network_change_after_preview',async()=>{
  const p=await fixture(roots);const a=upgrade();const plan=await a.planUpgrade(p,{id:randomUUID(),name:'Demo'});
  const file=join(p.networkDir,'alpha.yaml');await writeFile(file,(await readFile(file,'utf8')).replace('Source','Manual decision'));
  await expect(a.applyUpgrade(plan)).rejects.toMatchObject({code:'conflict'});
  expect(await readFile(file,'utf8')).toContain('Manual decision');
});
test('interrupted_upgrade_finishes_journal_without_accepting_stale_receipt',async()=>{
  const p=await fixture(roots);const a=upgrade();const before=await readProjectSnapshot(p,{sourceMode:'none'});const plan=await a.planUpgrade(p,{id:randomUUID(),name:'Demo'});
  const changes=Object.fromEntries(plan.files.map(f=>[f.path,f.content]));
  await writeFile(join(p.runtimeDir,'journal.json'),JSON.stringify({version:2,before:before.fingerprints,changes}));
  await writeFile(join(p.root,plan.files[0]!.path),plan.files[0]!.content);
  await expect(a.applyUpgrade(plan)).rejects.toMatchObject({code:'conflict'});
  const after=await readProjectSnapshot(p,{sourceMode:'none'});expect(after.integrity).toBe('valid');expect(after.meta?.schema).toBe(2);
});
test('cli_upgrade_is_explicit_reviewed_and_does_not_modify_host_configuration',async()=>{
  const p=await fixture(roots);const id=randomUUID();
  const args=[resolve('plugin/dist/cli.mjs'),'upgrade','--project-root',p.root,'--project-id',id,'--name','Demo'];
  const preview=JSON.parse((await exec(process.execPath,[...args,'--dry-run'])).stdout);
  expect(preview.receipt).toMatch(/^[a-f0-9]{64}$/);expect((await readProjectSnapshot(p,{sourceMode:'none'})).meta?.schema).toBe(1);
  await exec(process.execPath,[...args,'--approve-and-apply',preview.receipt]);
  expect((await readProjectSnapshot(p,{sourceMode:'none'})).meta?.schema).toBe(2);
  await expect(access(join(p.root,'.codex/config.toml'))).rejects.toMatchObject({code:'ENOENT'});
});
