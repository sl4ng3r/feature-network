import {afterEach,expect,test} from 'vitest';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {projectV2,testKnowledge,testFeature} from '../helpers/connected.js';
import {cleanup} from '../project/helpers.js';
const api=await import('../../src/memory/delta.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
function deltas(){expect(api?.prepareMemoryDelta).toBeTypeOf('function');return api!;}
test('multiple_insights_form_one_project_delta_with_cas_and_reason',async()=>{
 const a=deltas(),f=await projectV2(roots,'A'),snapshot=await f.snapshot();const delta=a.prepareMemoryDelta(snapshot,[testKnowledge('roles'),testKnowledge('access-notes')],[],'Two new ideas from the current discussion');
 expect(delta).toMatchObject({project:f.id,reason:'Two new ideas from the current discussion',update:{expectedRevision:snapshot.revision,sources:[],deletes:[]}});expect(delta!.changedPaths).toEqual(['network-spec/knowledge/access-notes.yaml','network-spec/knowledge/roles.yaml']);expect(delta!.changeDigest).toMatch(/^[a-f0-9]{64}$/);
});
test('same_statement_and_only_recording_date_change_are_noops',async()=>{
 const a=deltas(),f=await projectV2(roots,'A');const knowledge=testKnowledge();await mkdir(join(f.root,'network-spec/knowledge'));await writeFile(join(f.root,'network-spec/knowledge/roles.yaml'),JSON.stringify(knowledge));const snapshot=await f.snapshot();
 expect(a.prepareMemoryDelta(snapshot,[knowledge],[],'Repeated decision')).toBeNull();const later=structuredClone(knowledge);later.statements[0]!.origin.recorded_on='2026-10-15';expect(a.prepareMemoryDelta(snapshot,[later],[],'Discussed again')).toBeNull();
});
test('manual_statements_cannot_disappear_from_partial_updates',async()=>{
 const a=deltas(),f=await projectV2(roots,'A');const knowledge=testKnowledge();knowledge.statements.push({...knowledge.statements[0]!,id:'manual',text:'Preserve this manually recorded constraint.'});await mkdir(join(f.root,'network-spec/knowledge'));await writeFile(join(f.root,'network-spec/knowledge/roles.yaml'),JSON.stringify(knowledge));const snapshot=await f.snapshot();
 expect(()=>a.prepareMemoryDelta(snapshot,[testKnowledge()],[],'Update topic')).toThrow();
});
test('changed_requirement_needs_new_statement_and_explicit_supersession',async()=>{
 const a=deltas(),f=await projectV2(roots,'A');const knowledge=testKnowledge();knowledge.statements[0]!.type='requirement';await mkdir(join(f.root,'network-spec/knowledge'));await writeFile(join(f.root,'network-spec/knowledge/roles.yaml'),JSON.stringify(knowledge));const snapshot=await f.snapshot();
 const overwritten=structuredClone(knowledge);overwritten.statements[0]!.text='An incompatible new decision.';expect(()=>a.prepareMemoryDelta(snapshot,[overwritten],[],'New decision')).toThrow();
 const revised=structuredClone(knowledge);revised.statements[0]!.state='superseded';revised.statements.push({...knowledge.statements[0]!,id:'new-decision',text:'An incompatible new decision.',supersedes:[{project:f.id,knowledge:'roles',statement:'shared'}]});expect(a.prepareMemoryDelta(snapshot,[revised],[],'User explicitly replaced the previous decision')!.update.upserts[0]).toMatchObject({statements:[{id:'shared',state:'superseded'},{id:'new-decision'}]});
});
test('feature_updates_keep_supplied_manual_points_and_deletions_are_explicit',async()=>{
 const a=deltas(),f=await projectV2(roots,'A');const feature={...testFeature(),key_points:['Manual invariant']};await writeFile(join(f.root,'network-spec/access.yaml'),JSON.stringify(feature));const snapshot=await f.snapshot();
 const delta=a.prepareMemoryDelta(snapshot,[{...feature,summary:'Clarified access'}],[],'Inspected the change');expect((delta!.update.upserts[0] as any).key_points).toEqual(['Manual invariant']);
 expect(a.prepareMemoryDelta(snapshot,[],[],'No proposals')).toBeNull();expect(a.prepareMemoryDelta(snapshot,[],[],'Remove obsolete feature',['network-spec/access.yaml'])!.update.deletes).toEqual(['network-spec/access.yaml']);
 expect(()=>a.prepareMemoryDelta(snapshot,[],[],'Remove marker',['network-spec/_meta.yaml'])).toThrow();
});
test('adding_an_idea_preserves_historical_source_observations_without_reconfirming_them',async()=>{
 const f=await projectV2(roots,'A');const knowledge=testKnowledge();knowledge.statements[0]!.type='observation';knowledge.statements[0]!.origin.kind='source_review';knowledge.statements[0]!.evidence=[{path:'src/source.ts'}];await mkdir(join(f.root,'network-spec/knowledge'));await writeFile(join(f.root,'network-spec/knowledge/roles.yaml'),JSON.stringify(knowledge));const snapshot=await f.snapshot();
 knowledge.statements.push({...testKnowledge().statements[0]!,id:'another-idea'});
 await (await import('../../src/storage/documents.js')).applyDocumentUpdate(f.project,{expectedRevision:snapshot.revision,expected:{'network-spec/knowledge/roles.yaml':snapshot.fingerprints['network-spec/knowledge/roles.yaml']!},upserts:[knowledge],deletes:[],sources:[]});
 expect((await f.snapshot()).knowledge[0]!.statements).toHaveLength(2);
});
test('automatic_deletion_cannot_erase_an_active_user_requirement',async()=>{
 const a=deltas(),f=await projectV2(roots,'A');const knowledge=testKnowledge();knowledge.statements[0]!.type='requirement';await mkdir(join(f.root,'network-spec/knowledge'));await writeFile(join(f.root,'network-spec/knowledge/roles.yaml'),JSON.stringify(knowledge));
 const snapshot=await f.snapshot();expect(()=>a.prepareMemoryDelta(snapshot,[],[],'Cleanup',['network-spec/knowledge/roles.yaml'])).toThrow();
});
