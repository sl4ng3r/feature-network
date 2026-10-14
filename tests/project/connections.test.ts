import { afterEach, expect, test } from 'vitest';
import { mkdir,writeFile,readFile,access } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanup,exec } from './helpers.js';
import { projectV2 } from '../helpers/connected.js';
const api=await import('../../src/project/connections.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
function connections(){expect(api?.readConnections).toBeTypeOf('function');return api!;}
test('missing_registry_has_no_external_access_and_learning_is_disabled',async()=>{
 const f=await projectV2(roots,'A');const a=connections();const binding=await a.readConnections(f.project);
 expect(binding.learningEnabled).toBe(false);expect(binding.entries.size).toBe(1);
 await expect(a.assertConnection(binding,randomUUID(),'read_memory')).rejects.toMatchObject({code:'project_not_connected'});
 await expect(access(join(f.project.runtimeDir,'connections.yaml'))).rejects.toMatchObject({code:'ENOENT'});
});
test('reviewed_binding_is_local_nontransitive_and_revocable',async()=>{
 const [a,b,c]=await Promise.all(['A','B','C'].map(n=>projectV2(roots,n)));const api=connections();
 const config={schema:1 as const,learning:{enabled:true},projects:[{id:b!.id,root:b!.root,readSources:true,writeMemory:false}]};
 const preview=await api.planConnections(a!.project,config);await expect(api.applyConnections({...preview})).rejects.toMatchObject({code:'invalid_connections_plan'});await api.applyConnections(preview);
 const binding=await api.readConnections(a!.project);expect((await api.assertConnection(binding,b!.id,'read_source')).root).toBe(b!.root);
 await expect(api.assertConnection(binding,b!.id,'write_memory')).rejects.toMatchObject({code:'permission_denied'});
 await expect(api.assertConnection(binding,c!.id,'read_memory')).rejects.toMatchObject({code:'project_not_connected'});
 expect((await api.readConnections(b!.project)).entries.size).toBe(1);
 await writeFile(join(a!.project.runtimeDir,'connections.yaml'),JSON.stringify({...config,projects:[]}));
 await expect(api.assertConnection(binding,b!.id,'read_source')).rejects.toMatchObject({code:'connection_changed'});
});
test('wrong_identity_duplicate_worktree_and_late_target_replacement_are_rejected',async()=>{
 const a=await projectV2(roots,'A'),b=await projectV2(roots,'B');const api=connections();const entry={id:b.id,root:b.root,readSources:true,writeMemory:true};
 await expect(api.planConnections(a.project,{schema:1,learning:{enabled:true},projects:[entry,entry]})).rejects.toThrow();
 await expect(api.planConnections(a.project,{schema:1,learning:{enabled:true},projects:[{...entry,id:randomUUID()}]})).rejects.toThrow();
 await api.applyConnections(await api.planConnections(a.project,{schema:1,learning:{enabled:true},projects:[entry]}));
 const binding=await api.readConnections(a.project);
 await writeFile(join(b.root,'network-spec/_meta.yaml'),JSON.stringify({schema:2,coverage:'partial',project:{id:randomUUID(),name:'replacement'}}));
 await expect(api.assertConnection(binding,b.id,'read_memory')).rejects.toMatchObject({code:'project_identity_mismatch'});
});
test('cli_connection_receipt_binds_candidate_bytes_without_changing_counterpart',async()=>{
 const a=await projectV2(roots,'A'),b=await projectV2(roots,'B');const file=join(a.root,'selection.yaml');
 const config={schema:1,learning:{enabled:true},projects:[{id:b.id,root:b.root,readSources:true,writeMemory:true}]};await writeFile(file,JSON.stringify(config));
 const args=[resolve('plugin/dist/cli.mjs'),'connections','--project-root',a.root,'--config-file',file];
 const preview=JSON.parse((await exec(process.execPath,[...args,'--dry-run'])).stdout);
 await writeFile(file,JSON.stringify(config)+'\n');
 await expect(exec(process.execPath,[...args,'--approve-and-apply',preview.receipt])).rejects.toThrow();
 const next=JSON.parse((await exec(process.execPath,[...args,'--dry-run'])).stdout);await exec(process.execPath,[...args,'--approve-and-apply',next.receipt]);
 expect(await readFile(join(a.project.runtimeDir,'connections.yaml'),'utf8')).toContain(b.id);
 await expect(access(join(b.project.runtimeDir,'connections.yaml'))).rejects.toMatchObject({code:'ENOENT'});
});
test('connection_preview_cannot_be_mutated_to_display_different_rights',async()=>{
 const a=await projectV2(roots,'A'),b=await projectV2(roots,'B');const api=connections();
 const plan=await api.planConnections(a.project,{schema:1,learning:{enabled:true},projects:[{id:b.id,root:b.root,readSources:true,writeMemory:false}]});
 expect(()=>{plan.config.projects[0]!.writeMemory=true;}).toThrow();
 await api.applyConnections(plan);await expect(api.assertConnection(await api.readConnections(a.project),b.id,'write_memory')).rejects.toMatchObject({code:'permission_denied'});
});
