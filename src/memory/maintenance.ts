import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { stringify } from 'yaml';
import { z } from 'zod';
import { projectIdSchema,type ProjectId,type RevisionSet } from '../model/identity.js';
import { documentPath,editablePathSchema } from '../model/documents.js';
import { NetworkError } from '../model/errors.js';
import { assertConnection,type ConnectionBinding } from '../project/connections.js';
import type { Project } from '../project/root.js';
import { readProjectSnapshot,applyDocumentUpdate,recoverDocumentJournal,documentSources,type ProjectSnapshot,type DocumentStorageOptions } from '../storage/documents.js';
import { digest } from '../storage/journal.js';
import { storagePath,isMissing } from '../storage/lock.js';
import { readRuntime,writeRuntime,runtimeRevision } from '../storage/runtime.js';
import { connectedReviewSchema,recordConnectedReview,type ConnectedReview } from '../freshness/connected.js';
import { bindSourceAccess } from '../project/source-access.js';
import { prepareMemoryDelta,type PreparedDelta } from './delta.js';
import { memoryPolicy,type MemoryPolicyInput } from './policy.js';
import { invalidateConnectedCache } from '../query/connected.js';
import { withWorkMeter } from '../diagnostics/work.js';
export const maintenanceReviewIntentSchema=connectedReviewSchema.pick({outcome:true,reason:true}).extend({documentFingerprints:connectedReviewSchema.shape.documentFingerprints.optional(),revisions:connectedReviewSchema.shape.revisions.optional()});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const hashes=z.record(editablePathSchema,hash.nullable());
const targetSchema=z.strictObject({expectedRevision:hash,intendedRevision:hash,expected:hashes,intended:hashes,changeDigest:hash,intentDigest:hash,phase:z.enum(['prepared','applied','reviewed']),review:z.enum(['open','recorded']),targetRevision:hash.optional()});
const progressSchema=z.strictObject({version:z.literal(1),id:projectIdSchema,activeProject:projectIdSchema,registerRevision:hash,targets:z.record(projectIdSchema,targetSchema).refine(v=>Object.keys(v).length<=128)});
export type MaintenanceProgress=z.infer<typeof progressSchema>;
export interface MaintenanceContext extends Omit<MemoryPolicyInput,'enabled'> {operationId?:string;expectedOperationRevision?:string|null;review?:{outcome:ConnectedReview['outcome'];reason:string;documentFingerprints?:ConnectedReview['documentFingerprints'];revisions?:RevisionSet}}
export interface MaintenanceReceipt {operationId:string;operationRevision:string;targetRevision:string;publication:'applied'|'already_present';review:'recorded'|'open';diagnostics:[]}
export class MaintenanceError extends NetworkError {
 readonly operationId:string;readonly operationRevision:string|null;readonly publication:'unconfirmed'|'applied';
 constructor(error:unknown,id:string,revision:string|null,published:boolean){super(error instanceof NetworkError?error.code:'maintenance_failed','Memory maintenance incomplete');this.operationId=id;this.operationRevision=revision;this.publication=published?'applied':'unconfirmed';}
}
function key(id:string):string{if(!projectIdSchema.safeParse(id).success)throw new NetworkError('invalid_query','Invalid maintenance ID');return `maintenance/${id}`;}
export async function readMaintenance(active:Project,id:string):Promise<MaintenanceProgress|null>{
 const raw=await readRuntime<unknown>(active,key(id));if(raw===null)return null;if(!progressSchema.safeParse(raw).success)throw new NetworkError('invalid_runtime','Invalid maintenance record');return raw as MaintenanceProgress;
}
const stable=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
function intended(snapshot:ProjectSnapshot,delta:PreparedDelta):{fingerprints:Record<string,string|null>;revision:string}{
 const all={...snapshot.fingerprints};const changes:Record<string,string|null>={};for(const doc of delta.update.upserts){const path=documentPath(doc);changes[path]=digest(stringify(doc));all[path]=changes[path]!;}for(const path of delta.update.deletes){changes[path]=null;delete all[path];}
 return {fingerprints:changes,revision:digest(JSON.stringify(Object.fromEntries(Object.entries(all).sort(([a],[b])=>a<b?-1:a>b?1:0))))};
}
export async function applyMemoryDelta(binding:ConnectionBinding,target:ProjectId,delta:PreparedDelta|null,context:MaintenanceContext,options:DocumentStorageOptions={}):Promise<MaintenanceReceipt|null>{
 options=bindSourceAccess(binding,options);
 return withWorkMeter(options.meter,async()=>{
  const parsedReview=context.review===undefined?undefined:maintenanceReviewIntentSchema.safeParse(context.review);
  if(parsedReview&&!parsedReview.success)throw new NetworkError('invalid_decision','Invalid review intent');
  const reviewIntent=parsedReview?.success?parsedReview.data:undefined;
  if(!delta){if(reviewIntent)throw new NetworkError('invalid_decision','Review-only work uses the review API');return null;}
  const policy=memoryPolicy({...context,enabled:binding.learningEnabled});if(!policy.writeMemory)throw new NetworkError('memory_write_not_allowed','Memory writing is not allowed for this intent');
  if(reviewIntent&&(!policy.confirmSources||!delta.update.sources.length))throw new NetworkError('invalid_decision','This intent cannot confirm sources');
  if(delta.project!==target||delta.changeDigest!==digest(JSON.stringify({project:delta.project,update:delta.update,reason:delta.reason,changedPaths:delta.changedPaths})))throw new NetworkError('invalid_update','Prepared intent changed');
  const operationId=context.operationId??randomUUID();key(operationId);let latestRevision:string|null=null,published=false;
  try{
   const guard=async()=>{if(options.beforePublish)await options.beforePublish();await assertConnection(binding,binding.activeId,'read_memory');await assertConnection(binding,target,'write_memory');};
   const targetProject=await assertConnection(binding,target,'write_memory');let progress=await readMaintenance(binding.active,operationId);latestRevision=progress===null?null:runtimeRevision(progress);
   if((context.expectedOperationRevision??null)!==latestRevision)throw new NetworkError('conflict','Maintenance progress changed; use its current revision');
   if(progress&&(progress.activeProject!==binding.activeId||progress.registerRevision!==binding.revision))throw new NetworkError('connection_changed','Operation binding changed');
   const intentDigest=digest(stable({changeDigest:delta.changeDigest,mode:context.mode,explicitReadOnly:context.explicitReadOnly,basis:context.basis,review:reviewIntent??null}));
   let entry=progress?.targets[target];if(entry&&(entry.changeDigest!==delta.changeDigest||entry.intentDigest!==intentDigest))throw new NetworkError('conflict','A different intent is already recorded for this target');
   let current=await readProjectSnapshot(targetProject,{...options,sourceMode:'none'});
   if(current.integrity==='pending_recovery'){await recoverDocumentJournal(targetProject,{...options,beforePublish:guard});current=await readProjectSnapshot(targetProject,{...options,sourceMode:'none'});}
   const persist=async(next:MaintenanceProgress)=>{
    const token=runtimeRevision(next);if(token===latestRevision){progress=next;return;}
    await writeRuntime(binding.active,key(operationId),latestRevision,next,{...options,allowRecovery:false},guard);progress=next;latestRevision=token;
   };
   if(!entry){
    if(current.revision!==delta.update.expectedRevision)throw new NetworkError('conflict','Target changed before preparation');
    const checked=prepareMemoryDelta(current,delta.update.upserts,delta.update.sources,delta.reason,delta.update.deletes);if(!checked)return null;if(checked.changeDigest!==delta.changeDigest)throw new NetworkError('invalid_update','Delta is not a canonical change');
    const after=intended(current,delta);entry={expectedRevision:current.revision,intendedRevision:after.revision,expected:{...delta.update.expected},intended:after.fingerprints,changeDigest:delta.changeDigest,intentDigest,phase:'prepared',review:'open'};
    const next=progress?structuredClone(progress):{version:1 as const,id:operationId,activeProject:binding.activeId,registerRevision:binding.revision,targets:{}};next.targets[target]=entry;await persist(next);
   }
   let publication:MaintenanceReceipt['publication'];
   const matches=(expected:Record<string,string|null>)=>Object.entries(expected).every(([path,hash])=>(current.fingerprints[path]??null)===hash);
   if(current.revision===entry.intendedRevision&&matches(entry.intended)){publication='already_present';published=true;}
   else if(entry.phase==='prepared'&&current.revision===entry.expectedRevision&&matches(entry.expected)){
    await guard();const result=await applyDocumentUpdate(targetProject,delta.update,{...options,beforePublish:guard});if(result.revision!==entry.intendedRevision)throw new NetworkError('conflict','Published state differs from prepared intent');publication='applied';published=true;current=await readProjectSnapshot(targetProject,{...options,sourceMode:'none'});
   }else throw new NetworkError('conflict','Target is neither prepared nor intended state; preserve external work');
   invalidateConnectedCache(binding.active.root);invalidateConnectedCache(targetProject.root);
   let next=structuredClone(progress!);next.targets[target]={...entry,phase:entry.phase==='reviewed'?'reviewed':'applied',targetRevision:current.revision};await persist(next);
   let review:'recorded'|'open'='open';
   if(reviewIntent){
    const documents=structuredClone(reviewIntent.documentFingerprints??{});if(!reviewIntent.documentFingerprints){const own:Record<string,string>={};for(const doc of delta.update.upserts)if(documentSources(doc).length)own[documentPath(doc)]=current.fingerprints[documentPath(doc)]!;if(Object.keys(own).length)documents[target]=own;}
    if(documents[target]){for(const path of delta.changedPaths){if(current.fingerprints[path]!==undefined&&Object.hasOwn(documents[target],path))documents[target][path]=current.fingerprints[path]!;else if(delta.update.deletes.includes(path))delete documents[target][path];}}
    const revisions:Record<string,string>={...reviewIntent.revisions,[target]:current.revision};
    for(const id of new Set([...Object.keys(documents),...delta.update.sources.map(s=>s.project)]))if(revisions[id]===undefined){const project=await assertConnection(binding,id,'read_memory');revisions[id]=(await readProjectSnapshot(project,{...options,sourceMode:'none'})).revision;}
    await recordConnectedReview(binding,{project:target,networkRevision:current.revision,documentFingerprints:documents,revisions,sources:delta.update.sources,outcome:reviewIntent.outcome,reason:reviewIntent.reason},{...options,beforePublish:guard});review='recorded';
    next=structuredClone(progress!);next.targets[target]={...next.targets[target]!,phase:'reviewed',review:'recorded'};await persist(next);
   }
   return {operationId,operationRevision:latestRevision!,targetRevision:current.revision,publication,review,diagnostics:[]};
  }catch(error){throw new MaintenanceError(error,operationId,latestRevision,published);}
 });
}
export async function resumeMemoryDelta(binding:ConnectionBinding,target:ProjectId,delta:PreparedDelta|null,context:MaintenanceContext,options:DocumentStorageOptions={}):Promise<MaintenanceReceipt|null>{
 if(!context.operationId||!context.expectedOperationRevision)throw new NetworkError('invalid_update','Resumption requires operation ID and observed revision');return applyMemoryDelta(binding,target,delta,context,options);
}
export async function listMaintenance(active:Project,cursor?:{listingRevision:string;offset:number},limit=20):Promise<{items:{progress:MaintenanceProgress;revision:string}[];total:number;omitted:number;nextCursor?:{listingRevision:string;offset:number}}>{
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new NetworkError('invalid_query','Invalid maintenance page size');
 let names:string[];try{await storagePath(active,'.feature-network/values/maintenance/.entry');names=(await readdir(active.runtimeDir+'/values/maintenance')).filter(name=>name.endsWith('.json')&&projectIdSchema.safeParse(name.slice(0,-5)).success).sort();}catch(error){if(!isMissing(error))throw error;names=[];}
 const listingRevision=digest(JSON.stringify(names));if(cursor&&(cursor.listingRevision!==listingRevision||!Number.isSafeInteger(cursor.offset)||cursor.offset<0||cursor.offset>names.length))throw new NetworkError('stale_cursor','Maintenance listing changed');const offset=cursor?.offset??0;const items:{progress:MaintenanceProgress;revision:string}[]=[];
 for(const name of names.slice(offset,offset+limit)){const progress=await readMaintenance(active,name.slice(0,-5));if(!progress)throw new NetworkError('stale_cursor','Maintenance record disappeared');items.push({progress,revision:runtimeRevision(progress)});}
 const end=offset+items.length;return {items,total:names.length,omitted:names.length-end,...(end<names.length?{nextCursor:{listingRevision,offset:end}}:{})};
}
