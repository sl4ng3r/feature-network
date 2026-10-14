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

test('cold_and_bulk_index_updates_copy_shared_postings_and_incoming_edges_only_linearly',async()=>{const f=await connectedFixture(roots,{projects:1}),base=await f.active.snapshot(),size=400;const {digest}=await import('../../src/storage/journal.js');const features=Array.from({length:size},(_,i)=>({...testFeature('bulk-'+i),relations:i?[{to:'bulk-0',type:'depends_on' as const,status:'evidenced' as const,evidence:[{path:'src/source.ts'}],knowledge:[]}]:[]}));const snapshot=(docs:typeof features)=>{const fingerprints={'network-spec/_meta.yaml':base.fingerprints['network-spec/_meta.yaml']!,...Object.fromEntries(docs.map(d=>['network-spec/'+d.id+'.yaml',digest(JSON.stringify(d))]))};return {...base,features:docs,knowledge:[],fingerprints,revision:digest(JSON.stringify(fingerprints))};};const measure=<T>(action:()=>T)=>{const RealSet=globalThis.Set,iterate=Array.prototype[Symbol.iterator],filter=Array.prototype.filter;let copied=0;class CountedSet<T> extends RealSet<T>{constructor(values?:Iterable<T>|null){super(values);if(values instanceof RealSet)copied+=values.size;}}globalThis.Set=CountedSet;Array.prototype[Symbol.iterator]=function(this:any[]){if(this[0]&&typeof this[0].from==='string')copied+=this.length;return iterate.call(this);};Array.prototype.filter=function(this:any[],predicate:any,thisArg?:any){if(this[0]&&typeof this[0].from==='string')copied+=this.length;return filter.call(this,predicate,thisArg);};try{return {value:action(),copied};}finally{globalThis.Set=RealSet;Array.prototype[Symbol.iterator]=iterate;Array.prototype.filter=filter;}};const cold=measure(()=>api!.buildConnectedIndex(new Map([[f.active.id,snapshot(features)]]),f.binding.revision));expect(cold.copied).toBeLessThanOrEqual(30*size);const old=cold.value,provider=featureKey({project:f.active.id,feature:'bulk-0'});const changed=features.map(d=>({...d,summary:'Adjusted access rules'}));const updated=measure(()=>api!.refreshConnectedIndex(old,new Map([[f.active.id,snapshot(changed)]]),f.binding.revision));expect(updated.copied).toBeLessThanOrEqual(30*size);expect(old.tokens.get('checks')!.size).toBe(size);expect(old.tokens.has('adjusted')).toBe(false);expect(updated.value.tokens.get('adjusted')!.size).toBe(size);expect(old.incoming.get(provider)).toHaveLength(size-1);expect(updated.value.incoming.get(provider)).toHaveLength(size-1);expect(updated.value.incoming.get(provider)).not.toBe(old.incoming.get(provider));});
