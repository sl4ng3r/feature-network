import {afterEach,expect,test} from 'vitest';
import {access,mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {connectedFixture,testFeature,testKnowledge} from '../helpers/connected.js';
import {cleanup,tree,exec} from '../project/helpers.js';
import {readConnectedContext,readConnectedImpact} from '../../src/query/connected.js';
import {readConnectedFreshness,recordConnectedReview} from '../../src/freshness/connected.js';
import {prepareMemoryDelta} from '../../src/memory/delta.js';
import {applyMemoryDelta,readMaintenance,resumeMemoryDelta} from '../../src/memory/maintenance.js';
import {readConnections} from '../../src/project/connections.js';
import {runtimeRevision} from '../../src/storage/runtime.js';
import {createWorkMeter} from '../../src/diagnostics/work.js';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
test('external_business_oracle_and_scripted_memory_scenario_agree_without_claiming_agent_success',async()=>{
 const f=await connectedFixture(roots),[a,b,c]=f.projects as [typeof f.active,typeof f.active,typeof f.active];
 const sourcePaths=['src/publish.mjs','src/consume.mjs','src/view.mjs'];
 const old=["export const publish = u => ({id:u.id,role:u.role});", "export const consume = p => p.role === 'admin';", "export const view = allowed => allowed ? 'Admin' : 'Denied';"];
 for(let i=0;i<3;i++){await writeFile(join(f.projects[i]!.root,sourcePaths[i]!),old[i]!);const doc={...testFeature(),code:[{path:sourcePaths[i]!}],key_points:i===1?['Manual: keep denial visible.']:[]};if(i===2)doc.relations=[{to:{project:b.id,feature:'access'},type:'depends_on',status:'evidenced',evidence:[{path:sourcePaths[i]!}],knowledge:[]}];await writeFile(join(f.projects[i]!.root,'network-spec/access.yaml'),JSON.stringify(doc));}
 const oracleRoot=await tree();roots.push(oracleRoot);const oracle=join(oracleRoot,'held-out.mjs');
 await writeFile(oracle,`import assert from 'node:assert/strict';const [a,b,c]=await Promise.all(process.argv.slice(2).map(p=>import(p)));for(const role of ['admin','viewer']){const published=a.publish({id:'u',role,secret:'must not leak'});assert.deepEqual(published,{id:'u',entitlements:role==='admin'?['manage']:[]});assert.equal(b.consume(published),role==='admin');assert.equal(c.view(b.consume(published)),role==='admin'?'Management':'Denied');}process.stdout.write('held-out checks passed');`);
 expect(f.projects.every(p=>!oracle.startsWith(p.root+'/'))).toBe(true);
 const oracleArgs=[oracle,...f.projects.map((p,i)=>pathToFileURL(join(p.root,sourcePaths[i]!)).href)];await expect(exec(process.execPath,oracleArgs)).rejects.toThrow();
 await readConnectedContext(f.binding,{scope:'connected'});
 const consumer=(await b.snapshot()).features[0]!;consumer.relations=[{to:{project:a.id,feature:'access'},type:'depends_on',status:'evidenced',evidence:[{path:sourcePaths[1]!}],knowledge:[]}];await writeFile(join(b.root,'network-spec/access.yaml'),JSON.stringify(consumer));
 const current=["export const publish = u => ({id:u.id,entitlements:u.role==='admin'?['manage']:[]});","export const consume = p => p.entitlements?.includes('manage') === true;","export const view = allowed => allowed ? 'Management' : 'Denied';"];
 await writeFile(join(a.root,sourcePaths[0]!),current[0]!);
 const impact=await readConnectedImpact(f.binding,{features:[{project:a.id,feature:'access'}],direction:'incoming',depth:2,budget:64000},{readFreshness:refs=>readConnectedFreshness(f.binding,refs)});
 expect(new Set(impact.items.map((r:any)=>r.project))).toEqual(new Set([a.id,b.id,c.id]));expect((impact.items.find((r:any)=>r.project===c.id) as any).path).toHaveLength(2);await expect(exec(process.execPath,oracleArgs)).rejects.toThrow();
 for(let i=1;i<3;i++)await writeFile(join(f.projects[i]!.root,sourcePaths[i]!),current[i]!);expect((await exec(process.execPath,oracleArgs)).stdout).toContain('held-out checks passed');
 const bSnapshot=await b.snapshot(),source=await f.sourceReader({project:b.id,path:sourcePaths[1]!});await recordConnectedReview(f.binding,{project:b.id,networkRevision:bSnapshot.revision,documentFingerprints:{[b.id]:{'network-spec/access.yaml':bSnapshot.fingerprints['network-spec/access.yaml']!}},revisions:{[b.id]:bSnapshot.revision},sources:[source],outcome:'no_semantic_change',reason:'Inspected changed consumer; existing documented meaning holds'});
 expect(Object.values(await readConnectedFreshness(f.binding,[{project:b.id,feature:'access'}]))[0]).toMatchObject({review:'recorded',state:'current'});
 const requirement=testKnowledge('shared-policy');requirement.statements[0]!.type='requirement';requirement.statements[0]!.text='Keep denial visible across applications.';const meter=createWorkMeter();const idea=await applyMemoryDelta(f.binding,a.id,prepareMemoryDelta(await a.snapshot(),[requirement],[],'Explicit discussion requirement'),{mode:'unspecified',explicitReadOnly:false,basis:'conversation'},{meter});expect(idea!.review).toBe('open');expect(meter.sourceReadOps).toBe(1);expect((await b.snapshot()).features[0]!.key_points).toEqual(['Manual: keep denial visible.']);
 const delta=prepareMemoryDelta(await b.snapshot(),[testKnowledge('recovery')],[],'New consumer idea'),intent={mode:'unspecified' as const,explicitReadOnly:false,basis:'conversation' as const};let interrupted:any;
 try{await applyMemoryDelta(f.binding,b.id,delta,intent,{beforePublish:async()=>{if(await access(join(b.root,'network-spec/knowledge/recovery.yaml')).then(()=>true,()=>false))throw new Error('Synthetic interruption');}});}catch(error){interrupted=error;}
 expect(interrupted).toMatchObject({publication:'applied'});const progress=await readMaintenance(a.project,interrupted.operationId);const resumed=await resumeMemoryDelta(f.binding,b.id,delta,{...intent,operationId:interrupted.operationId,expectedOperationRevision:runtimeRevision(progress)},{});expect(resumed).toMatchObject({publication:'already_present',review:'open'});
 const unavailable=c.root+'-unavailable';roots.push(unavailable);await rename(c.root,unavailable);const binding=await readConnections(a.project);const partial=await readConnectedImpact(binding,{features:[{project:a.id,feature:'access'}],direction:'incoming',freshness:'last_known',budget:64000},{});expect(partial.projectsUnexamined).toContainEqual(expect.objectContaining({project:c.id}));expect(partial.incomplete).toBe(true);expect(partial.unexaminedMatchCount).toBeNull();
},20000);
