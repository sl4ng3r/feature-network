import { afterEach,expect,test } from 'vitest';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectedFixture,testFeature,testKnowledge } from '../helpers/connected.js';
import { cleanup } from '../project/helpers.js';
import { featureKey } from '../../src/model/identity.js';
import { createWorkMeter } from '../../src/diagnostics/work.js';
const api=await import('../../src/query/connected-index.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
test('same_ids_coexist_and_new_incoming_edges_are_indexed_once',async()=>{
 expect(api?.buildConnectedIndex).toBeTypeOf('function');const f=await connectedFixture(roots);const [a,b,c]=f.projects;
 const consumer=testFeature();consumer.relations=[{to:{project:a!.id,feature:'access'},type:'depends_on',status:'evidenced',evidence:[{path:'src/source.ts'}],knowledge:[]}];
 await writeFile(join(b!.root,'network-spec/access.yaml'),JSON.stringify(consumer));
 const snapshots=new Map(await Promise.all(f.projects.map(async p=>[p.id,await p.snapshot()] as const)));const index=api!.buildConnectedIndex(snapshots,f.binding.revision);
 const providerKey=featureKey({project:a!.id,feature:'access'}),consumerKey=featureKey({project:b!.id,feature:'access'});
 expect(index.entries.size).toBe(3);expect(index.incoming.get(providerKey)).toHaveLength(1);expect(index.incoming.get(providerKey)![0]!.from).toBe(consumerKey);
 expect(index.entries.get(featureKey({project:c!.id,feature:'access'}))).toBeDefined();
 await writeFile(join(b!.root,'network-spec/access.yaml'),JSON.stringify(testFeature()));snapshots.set(b!.id,await b!.snapshot());const meter=createWorkMeter();const next=api!.refreshConnectedIndex(index,snapshots,f.binding.revision,meter);
 expect(meter.indexReplacements).toBe(1);expect(next.incoming.get(providerKey)??[]).toEqual([]);expect(next.entries.get(providerKey)).toBe(index.entries.get(providerKey));expect(index.incoming.get(providerKey)).toHaveLength(1);
});
test('knowledge_search_does_not_replace_same_named_feature_or_create_dependency',async()=>{
 expect(api?.buildConnectedIndex).toBeTypeOf('function');const f=await connectedFixture(roots,{projects:1});await mkdir(join(f.active.root,'network-spec/knowledge'));
 await writeFile(join(f.active.root,'network-spec/knowledge/access.yaml'),JSON.stringify(testKnowledge('access')));
 const index=api!.buildConnectedIndex(new Map([[f.active.id,await f.active.snapshot()]]),f.binding.revision);
 expect(index.entries.size).toBe(2);expect(index.outgoing.get(featureKey({project:f.active.id,feature:'access'}))??[]).toEqual([]);expect([...index.entries.values()].filter(e=>e.kind==='knowledge')).toHaveLength(1);
});
