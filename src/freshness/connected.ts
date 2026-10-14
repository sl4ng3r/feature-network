import { z } from 'zod';
import { projectIdSchema,sourceRefSchema,featureKey,type ProjectId,type FeatureRef,type SourceObservation,type QualifiedSourceRef } from '../model/identity.js';
import { editablePathSchema,documentPath,type EditableDocument } from '../model/documents.js';
import { NetworkError } from '../model/errors.js';
import { assertConnection,type ConnectionBinding } from '../project/connections.js';
import { createSourceReader } from '../project/source-access.js';
import { readProjectSnapshot,documentSources,type DocumentStorageOptions,type ProjectSnapshot } from '../storage/documents.js';
import { readStorage,digest,revision,stableCapture } from '../storage/journal.js';
import { readRuntime,writeRuntime,runtimeRevision } from '../storage/runtime.js';
import type { ConnectedFreshness } from '../query/connected-pagination.js';
import { withWorkMeter } from '../diagnostics/work.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const connectedObservationSchema=z.union([z.strictObject({project:projectIdSchema,path:sourceRefSchema.shape.path,hash}),z.strictObject({project:projectIdSchema,path:sourceRefSchema.shape.path,state:z.literal('missing')})]);
export const connectedReviewSchema=z.strictObject({project:projectIdSchema,networkRevision:hash,documentFingerprints:z.record(projectIdSchema,z.record(editablePathSchema,hash).refine(v=>Object.keys(v).length<=100)).refine(v=>Object.keys(v).length<=32),revisions:z.record(projectIdSchema,hash).refine(v=>Object.keys(v).length<=32),sources:z.array(connectedObservationSchema).min(1).max(100),outcome:z.enum(['updated','no_semantic_change']),reason:z.string().trim().min(1).max(8192)});
export type ConnectedReview=z.infer<typeof connectedReviewSchema>;
const storeSchema=z.strictObject({version:z.literal(1),reviews:z.record(hash,connectedReviewSchema),entities:z.record(z.string(),hash),unmapped:z.record(z.string(),hash)});
type Store=z.infer<typeof storeSchema>;
const reviewKey='freshness/connected-reviews';
const sourceKey=(source:{project:string;path:string})=>JSON.stringify([source.project,'source',source.path]);
const entityKey=(project:ProjectId,doc:EditableDocument)=>'kind'in doc?JSON.stringify([project,'knowledge',doc.id]):featureKey({project,feature:doc.id});
const same=(a:SourceObservation,b:SourceObservation)=>a.project===b.project&&a.path===b.path&&('hash'in a&&'hash'in b?a.hash===b.hash:'state'in a&&'state'in b);
async function saved(project:Awaited<ReturnType<typeof assertConnection>>):Promise<{raw:unknown|null;store:Store|null;invalid:boolean}>{
 try{const raw=await readRuntime<unknown>(project,reviewKey);if(raw===null)return {raw,store:null,invalid:false};const parsed=storeSchema.safeParse(raw);return {raw,store:parsed.success?parsed.data:null,invalid:!parsed.success};}catch{return {raw:null,store:null,invalid:true};}
}
export async function inspectConnectedSources(binding:ConnectionBinding,refs:QualifiedSourceRef[],options:DocumentStorageOptions={}):Promise<SourceObservation[]>{
 return withWorkMeter(options.meter,async()=>{
  const reader=options.sourceReader??createSourceReader(binding,options);const observations:SourceObservation[]=[];const seen=new Set<string>();
  for(const ref of refs){const key=sourceKey(ref);if(seen.has(key))continue;seen.add(key);await assertConnection(binding,ref.project,'read_source');const observed=connectedObservationSchema.parse(await reader(ref));if(observed.project!==ref.project||observed.path!==ref.path)throw new NetworkError('conflict','Source reader returned a different source');observations.push(observed);}
  return observations;
 });
}
export async function recordConnectedReview(binding:ConnectionBinding,input:ConnectedReview,options:DocumentStorageOptions={}):Promise<void>{
 return withWorkMeter(options.meter,async()=>{
  const parsed=connectedReviewSchema.safeParse(input);if(!parsed.success)throw new NetworkError('invalid_decision','A bounded source-backed review is required');const receipt=parsed.data;
  if(new Set(receipt.sources.map(sourceKey)).size!==receipt.sources.length)throw new NetworkError('invalid_decision','Duplicate review source');
  const project=await assertConnection(binding,receipt.project,'write_memory');const snapshots=new Map<ProjectId,ProjectSnapshot>();
  const projects=new Set([receipt.project,...Object.keys(receipt.documentFingerprints),...receipt.sources.map(s=>s.project),...Object.keys(receipt.revisions)]);
  for(const id of projects){const bound=await assertConnection(binding,id,'read_memory');const snap=await readProjectSnapshot(bound,{...options,sourceMode:'none'});if(receipt.revisions[id]!==snap.revision||snap.integrity==='pending_recovery')throw new NetworkError('conflict','Observed project revision changed');snapshots.set(id,snap);}
  const own=snapshots.get(receipt.project)!;if(own.revision!==receipt.networkRevision)throw new NetworkError('conflict','Review target revision changed');
  const used=new Set<string>();const ownEntities:string[]=[];
  for(const [id,expected]of Object.entries(receipt.documentFingerprints)){
   const snap=snapshots.get(id)!;const docs=[...snap.features,...snap.knowledge];
   for(const [path,fingerprint]of Object.entries(expected)){
    if(snap.fingerprints[path]!==fingerprint)throw new NetworkError('conflict','Review document changed',[path]);const doc=docs.find(d=>documentPath(d)===path);if(!doc)throw new NetworkError('invalid_decision','Review document absent');
    const refs=documentSources(doc);if(!refs.length)throw new NetworkError('invalid_decision','Conversation alone cannot confirm sources');
    for(const ref of refs){const key=sourceKey({project:ref.project??id,path:ref.path});const observed=receipt.sources.find(s=>sourceKey(s)===key);if(!observed||!('hash'in observed))throw new NetworkError('invalid_decision','Every mapped review source needs its inspected hash');used.add(key);}
    if(id===receipt.project)ownEntities.push(entityKey(id,doc));
   }
  }
  const mapped=new Set([...own.features,...own.knowledge].flatMap(d=>documentSources(d).map(r=>sourceKey({project:r.project??receipt.project,path:r.path}))));
  const unmapped=receipt.sources.filter(s=>!used.has(sourceKey(s)));
  if(!ownEntities.length&&!unmapped.length)throw new NetworkError('invalid_decision','Review must concern its target project');
  if(unmapped.some(s=>receipt.outcome!=='no_semantic_change'||s.project!==receipt.project||mapped.has(sourceKey(s))))throw new NetworkError('invalid_decision','Unmapped reviews need a separate no-semantic-change decision');
  const guard=async()=>{
   if(options.beforePublish)await options.beforePublish();await assertConnection(binding,receipt.project,'write_memory');
   if(revision(await stableCapture(project))!==receipt.networkRevision)throw new NetworkError('conflict','Network changed before review publication');
   for(const [id,expected]of Object.entries(receipt.documentFingerprints)){const bound=await assertConnection(binding,id,'read_memory');for(const [path,fp]of Object.entries(expected)){const raw=await readStorage(bound,path);if(raw===null||digest(raw)!==fp)throw new NetworkError('conflict','Reviewed document changed',[path]);}}
   const actual=await inspectConnectedSources(binding,receipt.sources.map(s=>({project:s.project,path:s.path})),options);
   if(actual.some((s,i)=>!same(s,receipt.sources[i]!)))throw new NetworkError('conflict','Reviewed source changed');
  };
  await guard();const old=await saved(project);if(old.invalid)throw new NetworkError('invalid_runtime','Review store needs explicit repair');
  const next:Store=old.store?structuredClone(old.store):{version:1,reviews:{},entities:{},unmapped:{}};const id=digest(JSON.stringify(receipt));next.reviews[id]=receipt;
  for(const key of ownEntities)next.entities[key]=id;for(const observation of unmapped)next.unmapped[sourceKey(observation)]=id;
  const currentEntities=new Set([...own.features,...own.knowledge].map(d=>entityKey(receipt.project,d)));for(const key of Object.keys(next.entities))if(!currentEntities.has(key))delete next.entities[key];
  const retained=new Set([...Object.values(next.entities),...Object.values(next.unmapped)]);for(const key of Object.keys(next.reviews))if(!retained.has(key))delete next.reviews[key];
  if(old.raw!==null&&runtimeRevision(old.raw)===runtimeRevision(next))return;
  await writeRuntime(project,reviewKey,old.raw===null?null:runtimeRevision(old.raw),next,{...options,allowRecovery:false},guard);
 });
}
export async function readConnectedFreshness(binding:ConnectionBinding,refs:FeatureRef[],options:DocumentStorageOptions={}):Promise<ConnectedFreshness>{
 return withWorkMeter(options.meter,async()=>{
  const result:ConnectedFreshness={};const snapshots=new Map<string,Promise<ProjectSnapshot>>(),stores=new Map<string,Promise<Store|null>>(),observations=new Map<string,Promise<SourceObservation>>(),documentHashes=new Map<string,Promise<string|null>>();
  const snapshot=(id:ProjectId)=>{let v=snapshots.get(id);if(!v){v=assertConnection(binding,id,'read_memory').then(p=>readProjectSnapshot(p,{...options,sourceMode:'none'}));snapshots.set(id,v);}return v;};
  const store=(id:ProjectId)=>{let v=stores.get(id);if(!v){v=assertConnection(binding,id,'read_memory').then(p=>saved(p)).then(s=>s.store);stores.set(id,v);}return v;};
  const observe=(ref:QualifiedSourceRef)=>{const key=sourceKey(ref);let v=observations.get(key);if(!v){v=inspectConnectedSources(binding,[ref],options).then(items=>items[0]!);observations.set(key,v);}return v;};
  const docHash=(id:ProjectId,path:string)=>{const key=JSON.stringify([id,path]);let v=documentHashes.get(key);if(!v){v=assertConnection(binding,id,'read_memory').then(p=>readStorage(p,path)).then(raw=>raw===null?null:digest(raw));documentHashes.set(key,v);}return v;};
  for(const ref of refs){const key=featureKey(ref);let value:ConnectedFreshness[string]={state:'unknown',review:'open',resolution:'resolved'};
   try{
    const snap=await snapshot(ref.project);if(snap.integrity==='pending_recovery')throw new NetworkError('pending_recovery','Snapshot pending recovery');const feature=snap.features.find(f=>f.id===ref.feature);if(!feature){result[key]={...value,resolution:'missing'};continue;}
    const stored=await store(ref.project);const receiptId=stored?.entities[key],receipt=receiptId?stored?.reviews[receiptId]:undefined;let missing=false,changed=false,unknown=false;
    for(const source of documentSources(feature)){
     const actual=await observe({...source,project:source.project??ref.project});const previous=receipt?.sources.find(s=>sourceKey(s)===sourceKey(actual));
     if('state'in actual)missing=true;else if(!previous)unknown=true;else if(!same(actual,previous))changed=true;
    }
    value.state=missing?'missing':changed?'changed':unknown||!receipt?'unknown':'current';
    if(receipt&&value.state==='current'){
     let matches=true;
     for(const [id,docs]of Object.entries(receipt.documentFingerprints))for(const [path,hash]of Object.entries(docs))if(await docHash(id,path)!==hash)matches=false;
     for(const previous of receipt.sources)if(!same(await observe({project:previous.project,path:previous.path}),previous))matches=false;
     if(matches)value.review='recorded';
    }
    if(missing)value.resolution='missing';
   }catch(error){if(error instanceof NetworkError&&error.code==='connection_changed')throw error;value={state:'unknown',review:'open',resolution:error instanceof NetworkError&&error.code==='project_not_connected'?'not_connected':'unavailable'};}
   result[key]=value;
  }
  return result;
 });
}
export async function isConnectedUnmappedReviewed(binding:ConnectionBinding,projectId:ProjectId,observation:SourceObservation,options:DocumentStorageOptions={}):Promise<boolean>{
 const project=await assertConnection(binding,projectId,'read_memory');if(observation.project!==projectId)return false;const old=(await saved(project)).store;const id=old?.unmapped[sourceKey(observation)];const receipt=id?old?.reviews[id]:undefined;if(!receipt)return false;
 const actual=(await inspectConnectedSources(binding,[{project:projectId,path:observation.path}],options))[0]!;return same(actual,observation)&&receipt.sources.some(s=>same(s,actual));
}
export async function readConnectedReviewSummary(binding:ConnectionBinding,projectId:ProjectId):Promise<{basis:'last_known';storedEntityReviews:number;storedUnmappedReviews:number}>{
 const project=await assertConnection(binding,projectId,'read_memory');const store=(await saved(project)).store;return {basis:'last_known',storedEntityReviews:Object.keys(store?.entities??{}).length,storedUnmappedReviews:Object.keys(store?.unmapped??{}).length};
}
