import {afterEach,expect,test} from 'vitest';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {build} from 'esbuild';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connectedFixture,testKnowledge,testFeature} from '../helpers/connected.js';
import {cleanup} from '../project/helpers.js';
import {prepareMemoryDelta} from '../../src/memory/delta.js';
import {runtimeRevision} from '../../src/storage/runtime.js';
import {inspectConnectedSources,readConnectedFreshness} from '../../src/freshness/connected.js';
import {featureKey} from '../../src/model/identity.js';
const api=await import('../../src/memory/maintenance.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
test.each(['during_journal','after_target','before_review'] as const)('sigkill_%s_resumes_without_false_publication_or_review',async phase=>{
 expect(api?.applyMemoryDelta).toBeTypeOf('function');const f=await connectedFixture(roots),target=phase==='during_journal'?f.active:f.projects[1]!;const snapshot=await target.snapshot();
 const sources=phase==='before_review'?await inspectConnectedSources(f.binding,[{project:target.id,path:'src/source.ts'}],{}):[];
 const delta=prepareMemoryDelta(snapshot,[phase==='before_review'?{...testFeature(),summary:'Reviewed access'}:testKnowledge()],sources,'Inspected synthetic change')!;
 const context={mode:'unspecified' as const,explicitReadOnly:false,basis:phase==='before_review'?'analysis' as const:'conversation' as const,operationId:randomUUID(),...(phase==='before_review'?{review:{outcome:'updated' as const,reason:'Inspected the access source'}}:{})};
 const file=join(f.active.root,'maintenance-worker.mjs');await build({entryPoints:[resolve('tests/helpers/maintenance-worker.ts')],bundle:true,platform:'node',format:'esm',outfile:file,banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
 const child=fork(file,[f.active.root,target.id,JSON.stringify(delta),JSON.stringify(context),phase],{stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr?.on('data',bytes=>{stderr+=bytes.toString();});
 try{await Promise.race([once(child,'message'),once(child,'exit').then(([code])=>{throw new Error(`worker_exit_${code}: ${stderr}`);}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error(`worker_timeout: ${stderr}`)),8000);timer.unref();})]);const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;
  const progress=await api!.readMaintenance(f.active.project,context.operationId);expect(progress).not.toBeNull();
  if(phase==='before_review')expect((await readConnectedFreshness(f.binding,[{project:target.id,feature:'access'}],{}))[featureKey({project:target.id,feature:'access'})]!.review).toBe('open');
  const receipt=await api!.resumeMemoryDelta(f.binding,target.id,delta,{...context,expectedOperationRevision:runtimeRevision(progress)},{});
  expect(receipt).toMatchObject({publication:'already_present',review:phase==='before_review'?'recorded':'open'});const final=await target.snapshot();expect(final.integrity).toBe('valid');if(phase!=='before_review')expect(final.knowledge[0]!.id).toBe('roles');
 }finally{child.kill();}
},15000);
