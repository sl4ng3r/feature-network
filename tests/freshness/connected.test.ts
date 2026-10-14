import { afterEach,expect,test } from 'vitest';
import { mkdir,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { connectedFixture,testKnowledge,testFeature } from '../helpers/connected.js';
import { cleanup } from '../project/helpers.js';
import { featureKey } from '../../src/model/identity.js';
import { applyDocumentUpdate } from '../../src/storage/documents.js';
import { readConnectedImpact } from '../../src/query/connected.js';
const api=await import('../../src/freshness/connected.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
function reviews(){expect(api?.recordConnectedReview).toBeTypeOf('function');return api!;}
async function inspected(f:Awaited<ReturnType<typeof connectedFixture>>){const a=reviews(),snapshot=await f.active.snapshot();return {project:f.active.id,networkRevision:snapshot.revision,documentFingerprints:{[f.active.id]:{'network-spec/access.yaml':snapshot.fingerprints['network-spec/access.yaml']!}},revisions:{[f.active.id]:snapshot.revision},sources:await a.inspectConnectedSources(f.binding,[{project:f.active.id,path:'src/source.ts'}],{}),outcome:'no_semantic_change' as const,reason:'Inspected access source and checked the feature description'};}
test('inspected_sources_and_document_fingerprints_record_a_review',async()=>{
 const a=reviews(),f=await connectedFixture(roots);const review=await inspected(f);await a.recordConnectedReview(f.binding,review,{});
 expect((await a.readConnectedFreshness(f.binding,[{project:f.active.id,feature:'access'}],{}))[featureKey({project:f.active.id,feature:'access'})]).toEqual({state:'current',review:'recorded',resolution:'resolved'});
 const result=await readConnectedImpact(f.binding,{ids:['access']},{readFreshness:refs=>a.readConnectedFreshness(f.binding,refs,{})});expect(result.sourceValidationScope).toBe('returned_features');
});
test('conversation_without_sources_cannot_confirm_a_feature',async()=>{
 const a=reviews(),f=await connectedFixture(roots);await expect(a.recordConnectedReview(f.binding,{...await inspected(f),sources:[]},{})).rejects.toMatchObject({code:'invalid_decision'});
 expect((await a.readConnectedFreshness(f.binding,[{project:f.active.id,feature:'access'}],{}))[featureKey({project:f.active.id,feature:'access'})]!.review).toBe('open');
});
test('changed_missing_and_reappearing_sources_stay_open',async()=>{
 const a=reviews(),f=await connectedFixture(roots);await a.recordConnectedReview(f.binding,await inspected(f),{});const ref={project:f.active.id,feature:'access'},key=featureKey(ref);
 await writeFile(join(f.active.root,'src/source.ts'),'export const access = false;');expect((await a.readConnectedFreshness(f.binding,[ref],{}))[key]).toMatchObject({state:'changed',review:'open'});
 await rm(join(f.active.root,'src/source.ts'));expect((await a.readConnectedFreshness(f.binding,[ref],{}))[key]).toMatchObject({state:'missing',review:'open'});
 await writeFile(join(f.active.root,'src/source.ts'),'export const access = false;');expect((await a.readConnectedFreshness(f.binding,[ref],{}))[key]!.review).toBe('open');
});
test('unrelated_knowledge_edit_preserves_recorded_feature_review',async()=>{
 const a=reviews(),f=await connectedFixture(roots);await a.recordConnectedReview(f.binding,await inspected(f),{});const snap=await f.active.snapshot();
 await applyDocumentUpdate(f.active.project,{expectedRevision:snap.revision,expected:{'network-spec/knowledge/roles.yaml':null},upserts:[testKnowledge()],deletes:[],sources:[]});
 expect((await a.readConnectedFreshness(f.binding,[{project:f.active.id,feature:'access'}],{}))[featureKey({project:f.active.id,feature:'access'})]).toMatchObject({state:'current',review:'recorded'});
});
test('published_memory_without_review_receipt_does_not_clear_check',async()=>{
 const a=reviews(),f=await connectedFixture(roots);await a.recordConnectedReview(f.binding,await inspected(f),{});
 await writeFile(join(f.active.root,'network-spec/access.yaml'),JSON.stringify({...testFeature(),summary:'Changed feature meaning'}));
 expect((await a.readConnectedFreshness(f.binding,[{project:f.active.id,feature:'access'}],{}))[featureKey({project:f.active.id,feature:'access'})]!.review).toBe('open');
 await rm(join(f.active.project.runtimeDir,'values/freshness/connected-reviews.json'));
 expect((await a.readConnectedFreshness(f.binding,[{project:f.active.id,feature:'access'}],{}))[featureKey({project:f.active.id,feature:'access'})]).toMatchObject({state:'unknown',review:'open'});
});
test('stale_sources_revisions_and_forged_fingerprints_are_rejected',async()=>{
 const a=reviews(),f=await connectedFixture(roots);const review=await inspected(f);
 await expect(a.recordConnectedReview(f.binding,{...review,documentFingerprints:{[f.active.id]:{'network-spec/access.yaml':'0'.repeat(64)}}},{})).rejects.toMatchObject({code:'conflict'});
 await writeFile(join(f.active.root,'src/source.ts'),'changed');await expect(a.recordConnectedReview(f.binding,review,{})).rejects.toMatchObject({code:'conflict'});
});
test('external_source_permission_loss_is_not_a_local_clean_review',async()=>{
 const a=reviews(),f=await connectedFixture(roots);const feature=testFeature();feature.code=[{project:f.projects[1]!.id,path:'src/source.ts'}];await writeFile(join(f.active.root,'network-spec/access.yaml'),JSON.stringify(feature));
 const binding=(await import('../../src/project/connections.js'));const plan=await binding.planConnections(f.active.project,{schema:1,learning:{enabled:true},projects:[]});await binding.applyConnections(plan);
 const freshBinding=await binding.readConnections(f.active.project);const result=await a.readConnectedFreshness(freshBinding,[{project:f.active.id,feature:'access'}],{});expect(result[featureKey({project:f.active.id,feature:'access'})]).toMatchObject({state:'unknown',review:'open',resolution:'not_connected'});
});
test('unmapped_no_semantic_change_can_record_real_absence_without_fake_hash',async()=>{
 const a=reviews(),f=await connectedFixture(roots);const snap=await f.active.snapshot();const observation=await a.inspectConnectedSources(f.binding,[{project:f.active.id,path:'src/removed.ts'}],{});
 expect(observation).toEqual([{project:f.active.id,path:'src/removed.ts',state:'missing'}]);
 await a.recordConnectedReview(f.binding,{project:f.active.id,networkRevision:snap.revision,documentFingerprints:{},revisions:{[f.active.id]:snap.revision},sources:observation,outcome:'no_semantic_change',reason:'Removed unmapped source has no remaining feature semantics'},{});
 expect(await a.isConnectedUnmappedReviewed(f.binding,f.active.id,observation[0]!,{})).toBe(true);
 await writeFile(join(f.active.root,'src/removed.ts'),'reappeared');expect(await a.isConnectedUnmappedReviewed(f.binding,f.active.id,(await a.inspectConnectedSources(f.binding,[{project:f.active.id,path:'src/removed.ts'}],{}))[0]!,{})).toBe(false);
});
test('review_must_record_something_owned_by_its_target_project',async()=>{
 const a=reviews(),f=await connectedFixture(roots);const own=await f.active.snapshot(),other=await f.projects[1]!.snapshot();
 await expect(a.recordConnectedReview(f.binding,{project:f.active.id,networkRevision:own.revision,documentFingerprints:{[f.projects[1]!.id]:{'network-spec/access.yaml':other.fingerprints['network-spec/access.yaml']!}},revisions:{[f.active.id]:own.revision,[f.projects[1]!.id]:other.revision},sources:await a.inspectConnectedSources(f.binding,[{project:f.projects[1]!.id,path:'src/source.ts'}],{}),outcome:'updated',reason:'Only foreign evidence was supplied'},{})).rejects.toMatchObject({code:'invalid_decision'});
});
test('changed_supporting_foreign_document_opens_the_target_review',async()=>{
 const a=reviews(),f=await connectedFixture(roots);const feature=testFeature();feature.code.push({project:f.projects[1]!.id,path:'src/source.ts'});await writeFile(join(f.active.root,'network-spec/access.yaml'),JSON.stringify(feature));
 const own=await f.active.snapshot(),other=await f.projects[1]!.snapshot();
 await a.recordConnectedReview(f.binding,{project:f.active.id,networkRevision:own.revision,documentFingerprints:{[f.active.id]:{'network-spec/access.yaml':own.fingerprints['network-spec/access.yaml']!},[f.projects[1]!.id]:{'network-spec/access.yaml':other.fingerprints['network-spec/access.yaml']!}},revisions:{[f.active.id]:own.revision,[f.projects[1]!.id]:other.revision},sources:await a.inspectConnectedSources(f.binding,[{project:f.active.id,path:'src/source.ts'},{project:f.projects[1]!.id,path:'src/source.ts'}],{}),outcome:'updated',reason:'Inspected both sides of the contract'},{});
 await writeFile(join(f.projects[1]!.root,'network-spec/access.yaml'),JSON.stringify({...testFeature(),summary:'Provider contract changed'}));
 expect((await a.readConnectedFreshness(f.binding,[{project:f.active.id,feature:'access'}],{}))[featureKey({project:f.active.id,feature:'access'})]).toMatchObject({state:'current',review:'open'});
});
test('review_receipt_cannot_recover_a_concurrent_foreign_network_journal',async()=>{const a=reviews(),f=await connectedFixture(roots),b=f.projects[1]!,knowledge=testKnowledge('observed-contract');knowledge.statements[0]!.type='observation';knowledge.statements[0]!.origin.kind='source_review';knowledge.statements[0]!.evidence=[{project:f.active.id,path:'src/source.ts'}];await mkdir(join(b.root,'network-spec/knowledge'));await writeFile(join(b.root,'network-spec/knowledge/observed-contract.yaml'),JSON.stringify(knowledge));const {planConnections,applyConnections,readConnections}=await import('../../src/project/connections.js');await applyConnections(await planConnections(f.active.project,{schema:1,learning:{enabled:true},projects:[{id:b.id,root:b.root,readSources:false,writeMemory:true}]}));const binding=await readConnections(f.active.project),bs=await b.snapshot(),as=await f.active.snapshot(),source=(await a.inspectConnectedSources(binding,[{project:f.active.id,path:'src/source.ts'}]))[0]!;const {createWorkMeter}=await import('../../src/diagnostics/work.js');const meter=createWorkMeter();let injected=false;const beforePublish=async()=>{if(injected)return;injected=true;await writeFile(join(b.project.runtimeDir,'journal.json'),JSON.stringify({version:2,before:bs.fingerprints,changes:{'network-spec/knowledge/pending.yaml':JSON.stringify(testKnowledge('pending'))}}));};await expect(a.recordConnectedReview(binding,{project:b.id,networkRevision:bs.revision,documentFingerprints:{[b.id]:{'network-spec/knowledge/observed-contract.yaml':bs.fingerprints['network-spec/knowledge/observed-contract.yaml']!}},revisions:{[b.id]:bs.revision,[f.active.id]:as.revision},sources:[source],outcome:'no_semantic_change',reason:'Inspected only the active provider source'}, {meter,beforePublish})).rejects.toThrow();expect(meter.sourceReadOps).toBe(1);const {readFile,access}=await import('node:fs/promises');expect(await readFile(join(b.project.runtimeDir,'journal.json'),'utf8')).toContain('pending.yaml');await expect(access(join(b.root,'network-spec/knowledge/pending.yaml'))).rejects.toMatchObject({code:'ENOENT'});});
