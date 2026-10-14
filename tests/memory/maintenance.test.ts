import {afterEach,expect,test} from 'vitest';
import {readFile,writeFile,access,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connectedFixture,testKnowledge} from '../helpers/connected.js';
import {cleanup} from '../project/helpers.js';
import {prepareMemoryDelta} from '../../src/memory/delta.js';
import {runtimeRevision} from '../../src/storage/runtime.js';
import {createWorkMeter} from '../../src/diagnostics/work.js';
const api=await import('../../src/memory/maintenance.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
const intent={mode:'unspecified' as const,explicitReadOnly:false,basis:'conversation' as const};
function maintenance(){expect(api?.applyMemoryDelta).toBeTypeOf('function');return api!;}
test('one_foreign_target_gets_memory_not_product_or_configuration_changes',async()=>{
 const a=maintenance(),f=await connectedFixture(roots),target=f.projects[1]!;const source=await readFile(join(target.root,'src/source.ts'),'utf8');const delta=prepareMemoryDelta(await target.snapshot(),[testKnowledge()],[],'New role idea');
 const receipt=await a.applyMemoryDelta(f.binding,target.id,delta,intent,{});expect(receipt).toMatchObject({publication:'applied',review:'open'});expect(await readFile(join(target.root,'network-spec/knowledge/roles.yaml'),'utf8')).toContain('Consider common roles.');expect(await readFile(join(target.root,'src/source.ts'),'utf8')).toBe(source);
 await expect(access(join(target.project.runtimeDir,'connections.yaml'))).rejects.toMatchObject({code:'ENOENT'});expect((await a.readMaintenance(f.active.project,receipt!.operationId))!.targets[target.id]!.phase).toBe('applied');
});
test('actual_learning_configuration_and_readonly_intent_control_writes',async()=>{
 const a=maintenance(),f=await connectedFixture(roots,{learning:false}),delta=prepareMemoryDelta(await f.active.snapshot(),[testKnowledge()],[],'New idea');
 await expect(a.applyMemoryDelta(f.binding,f.active.id,delta,intent,{})).rejects.toMatchObject({code:'memory_write_not_allowed'});
 await expect(a.applyMemoryDelta(f.binding,f.active.id,delta,{...intent,mode:'sync',explicitReadOnly:true},{})).rejects.toMatchObject({code:'memory_write_not_allowed'});
 await expect(access(join(f.active.root,'network-spec/knowledge/roles.yaml'))).rejects.toMatchObject({code:'ENOENT'});
});
test('noop_does_not_create_a_maintenance_record',async()=>{
 const a=maintenance(),f=await connectedFixture(roots);expect(await a.applyMemoryDelta(f.binding,f.active.id,null,intent,{})).toBeNull();await expect(access(join(f.active.project.runtimeDir,'values/maintenance'))).rejects.toMatchObject({code:'ENOENT'});
});
test('retry_checks_intended_state_without_rewriting_or_overwriting_manual_changes',async()=>{
 const a=maintenance(),f=await connectedFixture(roots),target=f.projects[1]!,delta=prepareMemoryDelta(await target.snapshot(),[testKnowledge()],[],'New idea');const first=await a.applyMemoryDelta(f.binding,target.id,delta,intent,{});const meter=createWorkMeter();
 const second=await a.resumeMemoryDelta(f.binding,target.id,delta,{...intent,operationId:first!.operationId,expectedOperationRevision:first!.operationRevision},{meter});expect(second!.publication).toBe('already_present');expect(meter.knowledgeWrites).toBe(0);expect(meter.runtimeWrites).toBe(0);
 await writeFile(join(target.root,'network-spec/knowledge/roles.yaml'),JSON.stringify({...testKnowledge(),summary:'Manual work'}));const progress=await a.readMaintenance(f.active.project,first!.operationId);
 await expect(a.resumeMemoryDelta(f.binding,target.id,delta,{...intent,operationId:first!.operationId,expectedOperationRevision:runtimeRevision(progress)},{})).rejects.toMatchObject({code:'conflict',operationId:first!.operationId});expect(await readFile(join(target.root,'network-spec/knowledge/roles.yaml'),'utf8')).toContain('Manual work');
});
test('concurrent_same_operation_has_one_writer_and_preserves_progress_cas',async()=>{
 const a=maintenance(),f=await connectedFixture(roots),target=f.projects[1]!,delta=prepareMemoryDelta(await target.snapshot(),[testKnowledge()],[],'Concurrent idea');const context={...intent,operationId:randomUUID()};
 const outcomes=await Promise.allSettled([a.applyMemoryDelta(f.binding,target.id,delta,context,{}),a.applyMemoryDelta(f.binding,target.id,delta,context,{})]);expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);expect((await target.snapshot()).knowledge).toHaveLength(1);
});
test('late_revocation_blocks_target_and_critical_phases_never_hold_two_project_locks',async()=>{
 const a=maintenance(),f=await connectedFixture(roots),target=f.projects[1]!,delta=prepareMemoryDelta(await target.snapshot(),[testKnowledge()],[],'Scoped idea');let checks=0;
 const beforePublish=async()=>{checks++;const owners=await Promise.all([f.active,target].map(p=>readFile(join(p.project.runtimeDir,'lock'),'utf8').then(s=>JSON.parse(s).pid).catch(e=>{if(e.code==='ENOENT')return null;throw e;})));expect(owners.filter(pid=>pid===process.pid).length).toBeLessThanOrEqual(1);};
 await a.applyMemoryDelta(f.binding,target.id,delta,intent,{beforePublish});expect(checks).toBeGreaterThan(0);
 const another=prepareMemoryDelta(await target.snapshot(),[testKnowledge('other')],[],'Another idea');let revoked=false;const guard=async()=>{if(!revoked){revoked=true;await (await import('../helpers/connected.js')).revokeConnectionOnDisk(f.active,target.id);}};
 await expect(a.applyMemoryDelta(f.binding,target.id,another,intent,{beforePublish:guard})).rejects.toMatchObject({code:'connection_changed'});await expect(access(join(target.root,'network-spec/knowledge/other.yaml'))).rejects.toMatchObject({code:'ENOENT'});
});
test('invalid_review_intent_is_rejected_before_any_target_or_progress_write',async()=>{
 const a=maintenance(),f=await connectedFixture(roots),target=f.projects[1]!;const file=join(target.root,'network-spec/access.yaml');const before=await readFile(file,'utf8');const sources=[await f.sourceReader({project:target.id,path:'src/source.ts'})];const feature=(await target.snapshot()).features[0]!;
 const delta=prepareMemoryDelta(await target.snapshot(),[{...feature,summary:'Reviewed source'}],sources,'Inspected source');
 await expect(a.applyMemoryDelta(f.binding,target.id,delta,{mode:'unspecified',explicitReadOnly:false,basis:'analysis',review:{outcome:'updated',reason:''}},{})).rejects.toMatchObject({code:'invalid_decision'});
 expect(await readFile(file,'utf8')).toBe(before);await expect(access(join(f.active.project.runtimeDir,'values/maintenance'))).rejects.toMatchObject({code:'ENOENT'});
});
test('one_operation_can_track_two_targets_and_listing_is_paginated_readonly',async()=>{
 const a=maintenance(),f=await connectedFixture(roots),b=f.projects[1]!,c=f.projects[2]!;
 const first=await a.applyMemoryDelta(f.binding,b.id,prepareMemoryDelta(await b.snapshot(),[testKnowledge()],[],'B idea'),intent,{});
 const second=await a.applyMemoryDelta(f.binding,c.id,prepareMemoryDelta(await c.snapshot(),[testKnowledge()],[],'C idea'),{...intent,operationId:first!.operationId,expectedOperationRevision:first!.operationRevision},{});
 expect(Object.keys((await a.readMaintenance(f.active.project,second!.operationId))!.targets).sort()).toEqual([b.id,c.id].sort());
 await a.applyMemoryDelta(f.binding,f.active.id,prepareMemoryDelta(await f.active.snapshot(),[testKnowledge()],[],'A idea'),intent,{});
 const page=await a.listMaintenance(f.active.project,undefined,1);expect(page.items).toHaveLength(1);expect(page.omitted).toBe(1);const next=await a.listMaintenance(f.active.project,page.nextCursor,1);expect(next.items).toHaveLength(1);expect(next.omitted).toBe(0);
 await expect(a.readMaintenance(f.active.project,'../../escape')).rejects.toMatchObject({code:'invalid_query'});
 await writeFile(join(f.active.project.runtimeDir,'values/maintenance',first!.operationId+'.json'),JSON.stringify({version:999}));await expect(a.readMaintenance(f.active.project,first!.operationId)).rejects.toMatchObject({code:'invalid_runtime'});
});
test('foreign_memory_write_cannot_read_sources_when_only_memory_writing_was_selected',async()=>{const a=maintenance(),f=await connectedFixture(roots),b=f.projects[1]!;const {planConnections,applyConnections,readConnections}=await import('../../src/project/connections.js');await applyConnections(await planConnections(f.active.project,{schema:1,learning:{enabled:true},projects:[{id:b.id,root:b.root,readSources:false,writeMemory:true}]}));const binding=await readConnections(f.active.project),delta=prepareMemoryDelta(await b.snapshot(),[testKnowledge()],[],'Discussion with no source permission'),meter=createWorkMeter();await expect(a.applyMemoryDelta(binding,b.id,delta,intent,{meter})).rejects.toMatchObject({code:'permission_denied'});expect(meter.sourceReadOps).toBe(0);expect((await b.snapshot()).knowledge).toHaveLength(0);});
test('pending_foreign_recovery_cannot_bypass_denied_target_source_reads',async()=>{const a=maintenance(),f=await connectedFixture(roots),b=f.projects[1]!;const {planConnections,applyConnections,readConnections}=await import('../../src/project/connections.js');const {stringify}=await import('yaml');const snap=await b.snapshot(),delta=prepareMemoryDelta(snap,[testKnowledge()],[],'Interrupted conversation');await mkdir(b.project.runtimeDir,{recursive:true});await writeFile(join(b.project.runtimeDir,'journal.json'),JSON.stringify({version:2,before:snap.fingerprints,changes:{'network-spec/knowledge/roles.yaml':stringify(testKnowledge())}}));await applyConnections(await planConnections(f.active.project,{schema:1,learning:{enabled:true},projects:[{id:b.id,root:b.root,readSources:false,writeMemory:true}]}));const binding=await readConnections(f.active.project),meter=createWorkMeter();await expect(a.applyMemoryDelta(binding,b.id,delta,intent,{meter})).rejects.toMatchObject({code:'permission_denied'});expect(meter.sourceReadOps).toBe(0);await expect(access(join(b.root,'network-spec/knowledge/roles.yaml'))).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(b.project.runtimeDir,'journal.json'),'utf8')).toContain('roles.yaml');});
