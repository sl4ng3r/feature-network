import {z} from 'zod';
import {stringify} from 'yaml';
import type {CallToolResult} from '@modelcontextprotocol/server';
import {NetworkError} from '../model/errors.js';
import {projectIdSchema} from '../model/identity.js';
import {editablePathSchema,documentPath,type EditablePath,type EditableDocument,type NetworkPath} from '../model/documents.js';
import {featureV2Schema,knowledgeSchema,metaV2Schema} from '../model/v2.js';
import {connectedContextSchema,connectedImpactSchema,connectedParametersSchema} from '../query/connected-pagination.js';
import {readConnectedContext,readConnectedImpact,invalidateConnectedCache} from '../query/connected.js';
import {connectedObservationSchema,recordConnectedReview,readConnectedFreshness,readConnectedReviewSummary,isConnectedUnmappedReviewed} from '../freshness/connected.js';
import {applyMemoryDelta,maintenanceReviewIntentSchema,readMaintenance,listMaintenance,MaintenanceError,type MaintenanceContext} from '../memory/maintenance.js';
import {memoryPolicy} from '../memory/policy.js';
import type {PreparedDelta} from '../memory/delta.js';
import {assertConnection,type ConnectionBinding} from '../project/connections.js';
import {createSourceReader} from '../project/source-access.js';
import type {Project} from '../project/root.js';
import {readGitState} from '../project/git.js';
import {isIgnoredChange} from '../freshness/references.js';
import {readProjectSnapshot,commitNetworkDocuments,readLocalSource,documentSources,type DocumentStorageOptions} from '../storage/documents.js';
import {digest,hasJournal,revision} from '../storage/journal.js';
import {runtimeRevision} from '../storage/runtime.js';
import type {ToolName} from './tools.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),budget=connectedParametersSchema.shape.budget;
const purpose=z.strictObject({mode:z.enum(['init','sync','status','show','impact','check','unspecified']),explicitReadOnly:z.boolean(),basis:z.enum(['conversation','analysis','development','explicit_sync'])});
export const memoryUpdateSchema=z.strictObject({kind:z.literal('memory'),targetProject:projectIdSchema.optional(),initialize:metaV2Schema.shape.project.optional(),expectedRevision:hash,expected:z.record(editablePathSchema,hash.nullable()),upserts:z.array(z.union([featureV2Schema,knowledgeSchema])).max(100),deletes:z.array(editablePathSchema).max(100),sources:z.array(connectedObservationSchema).max(100),purpose,reason:z.string().trim().min(1).max(8192),operationId:projectIdSchema.optional(),expectedOperationRevision:hash.nullable().optional(),review:maintenanceReviewIntentSchema.optional(),budget});
export const connectedCheckSchema=z.strictObject({mode:z.enum(['summary','full']).optional(),scope:z.enum(['active','connected']).optional(),projects:z.array(projectIdSchema).max(128).optional(),maxProjects:z.number().int().min(1).max(32).optional(),maxVisitedFeatures:z.number().int().min(1).max(10000).optional(),sessionId:z.string().min(1).max(128).optional(),maintenance:z.strictObject({operationId:projectIdSchema.optional(),cursor:z.strictObject({listingRevision:hash,offset:z.number().int().nonnegative()}).optional(),limit:z.number().int().min(1).max(100).optional()}).optional(),budget});
export const connectedToolSchemas={network_context:connectedContextSchema,network_impact:connectedImpactSchema,network_update:memoryUpdateSchema,network_check:connectedCheckSchema};
const text='FeatureNetwork connected memory.';
const bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
const wrap=(value:object):CallToolResult=>({content:[{type:'text',text}],structuredContent:value as Record<string,unknown>});
const reserve=bytes(wrap({}))-bytes({});
function fit(value:object,budget:number):CallToolResult{const response=wrap(value);if(bytes(response)>budget)throw new NetworkError('response_too_large','Increase the response budget or narrow the selection');return response;}
/** Fixed bounded receipt shape is checked before any mutation, including partial failure. */
function preflight(budget:number):void{
 fit({operationId:'0'.repeat(36),operationRevision:'0'.repeat(64),targetRevision:'0'.repeat(64),publication:'already_present',review:'recorded',diagnostics:[]},budget);
 fit({error:{code:'connection_changed',message:'Operation incomplete; read maintenance and resupply identical intent with its current token.'},operationId:'0'.repeat(36),operationRevision:'0'.repeat(64),publication:'unconfirmed',review:'open'},budget);
 // Leave room for stable SDK projection metadata and safe failure codes.
 if(budget<900)throw new NetworkError('response_too_large','Memory mutations require at least 900 response bytes');
}
export function maintenanceFailure(error:MaintenanceError):CallToolResult{return {...wrap({error:{code:error.code,message:'Operation incomplete; read maintenance and resupply identical intent with its current token.'},operationId:error.operationId,operationRevision:error.operationRevision,publication:error.publication,review:'open'}),isError:true};}
function reconstruct(input:z.infer<typeof memoryUpdateSchema>,target:string):PreparedDelta{
 const upserts=[...input.upserts].sort((a,b)=>documentPath(a)<documentPath(b)?-1:documentPath(a)>documentPath(b)?1:0);
 const deletes=[...new Set(input.deletes)].sort() as EditablePath[];const paths=[...upserts.map(documentPath),...deletes].sort();
 if(new Set(paths).size!==paths.length||JSON.stringify(Object.keys(input.expected).sort())!==JSON.stringify(paths))throw new NetworkError('invalid_update','Expected fingerprints must cover exactly the explicit changes');
 const update={expectedRevision:input.expectedRevision,expected:Object.fromEntries(paths.map(p=>[p,input.expected[p]!])),upserts,deletes,sources:[...input.sources].sort((a,b)=>(a.project<b.project?-1:a.project>b.project?1:0)||(a.path<b.path?-1:a.path>b.path?1:0))};
 const delta={project:target,update,reason:input.reason,changedPaths:paths};return {...delta,changeDigest:digest(JSON.stringify(delta))};
}
async function update(binding:ConnectionBinding,raw:unknown,options:DocumentStorageOptions):Promise<CallToolResult>{
 const input=memoryUpdateSchema.parse(raw),requested=input.budget??12000;preflight(requested);
 if(input.initialize)throw new NetworkError('conflict','Already initialized');
 const target=input.targetProject??binding.activeId,policy=memoryPolicy({...input.purpose,enabled:binding.learningEnabled});
 if(!policy.writeMemory)throw new NetworkError('memory_write_not_allowed','Writing is not allowed for this intent');
 const targetProject=await assertConnection(binding,target,'write_memory');
 if(!input.upserts.length&&!input.deletes.length){
  if(Object.keys(input.expected).length)throw new NetworkError('invalid_update','Review-only requests have no editable expectations');
  if(!input.review){const snapshot=await readProjectSnapshot(targetProject,{...options,sourceMode:'none'});if(snapshot.integrity==='pending_recovery'||snapshot.revision!==input.expectedRevision)throw new NetworkError('conflict','No-op target revision changed');return fit({targetRevision:input.expectedRevision,publication:'noop',review:'open',diagnostics:[]},requested);}
  if(!policy.confirmSources||!input.review.documentFingerprints||!input.review.revisions)throw new NetworkError('invalid_decision','Review-only work needs explicit inspected document fingerprints and revisions');
  await recordConnectedReview(binding,{...input.review,project:target,networkRevision:input.expectedRevision,sources:input.sources,documentFingerprints:input.review.documentFingerprints,revisions:input.review.revisions},options);
  return fit({targetRevision:input.expectedRevision,publication:'noop',review:'recorded',diagnostics:[]},requested);
 }
 const delta=reconstruct(input,target);
 const receipt=await applyMemoryDelta(binding,target,delta,JSON.parse(JSON.stringify({...input.purpose,...(input.operationId?{operationId:input.operationId}:{}),...(input.expectedOperationRevision!==undefined?{expectedOperationRevision:input.expectedOperationRevision}:{}),...(input.review?{review:input.review}:{})})) as MaintenanceContext,options);
 return fit(receipt??{targetRevision:input.expectedRevision,publication:'noop',review:'open',diagnostics:[]},requested);
}
/** Explicit first-feature initialization only; no registry, learning or placeholder knowledge. */
export async function initializeConnected(project:Project,raw:unknown,options:DocumentStorageOptions):Promise<CallToolResult>{
 const input=memoryUpdateSchema.parse(raw),budget=input.budget??12000;preflight(budget);
 if(!input.initialize||input.purpose.mode!=='init'||input.purpose.explicitReadOnly||input.targetProject&&input.targetProject!==input.initialize.id||input.operationId||input.review||input.deletes.length||!input.upserts.length||input.upserts.some(d=>'kind'in d))throw new NetworkError('invalid_update','Initialization requires an explicit real first feature');
 const before=await readProjectSnapshot(project,{...options,sourceMode:'none'});if(before.meta||before.integrity!=='not_initialized'||Object.keys(before.fingerprints).length||before.revision!==input.expectedRevision||input.expectedRevision!==revision({}))throw new NetworkError('conflict','Initialization requires an unchanged empty network');
 const id=input.initialize.id,delta=reconstruct(input,id);if(Object.values(delta.update.expected).some(v=>v!==null))throw new NetworkError('conflict','New documents require null expectations');
 const reader=async(ref:{project:string;path:string})=>{if(ref.project!==id)throw new NetworkError('project_not_connected','Initialization only inspects active sources');return {project:id,path:ref.path,hash:await readLocalSource(project,ref.path,options)};};
 const guard=async()=>{for(const source of input.sources){const observed=await reader(source);if(!('hash'in source)||!('hash'in observed)||observed.hash!==source.hash)throw new NetworkError('conflict','Initial source changed');}};
 for(const doc of input.upserts)for(const ref of documentSources(doc))if(!input.sources.some(s=>s.project===(ref.project??id)&&s.path===ref.path&&'hash'in s))throw new NetworkError('invalid_decision','Every initial source requires its inspected hash');
 const changes:Record<NetworkPath,string>={'network-spec/_meta.yaml':stringify({schema:2,coverage:'partial',project:input.initialize,areas:[]})};for(const doc of input.upserts)changes[documentPath(doc)]=stringify(doc);
 await guard();const saved=await commitNetworkDocuments(project,input.expectedRevision,changes,{...options,sourceReader:reader,beforePublish:guard});invalidateConnectedCache(project.root);
 return fit({targetRevision:saved.revision,publication:'applied',review:'open',diagnostics:[]},budget);
}
async function check(binding:ConnectionBinding,raw:unknown,options:DocumentStorageOptions):Promise<CallToolResult>{
 const input=connectedCheckSchema.parse(raw),budget=input.budget??12000,mode=input.mode??'summary';
 if(input.maintenance){const m=input.maintenance;const maintenance=m.operationId?{progress:await readMaintenance(binding.active,m.operationId),revision:null as string|null}:await listMaintenance(binding.active,m.cursor,m.limit);if('progress'in maintenance&&maintenance.progress)maintenance.revision=runtimeRevision(maintenance.progress);return fit({basis:'last_known',pendingRecovery:await hasJournal(binding.active),maintenance},budget);}
 const selected=[...new Set([binding.activeId,...(input.projects??[]),...(input.scope==='connected'?[...binding.entries.keys()].sort():[])])],chosen=selected.slice(0,input.maxProjects??8),unexamined=selected.slice(chosen.length).map(project=>({project,reason:'project_limit'}));
 const projects:Record<string,unknown>={},freshness:Record<string,unknown>={},unknownChanges:{project:string;path:string;review:'recorded'|'open'|'unknown'}[]=[],diagnostics:unknown[]=[];let remaining=input.maxVisitedFeatures??1000,featuresOmitted=0,unknownChangesOmitted=0;
 for(const id of chosen){
  let project:Project;try{project=await assertConnection(binding,id,'read_memory');}catch(error){if(id===binding.activeId)throw error;unexamined.push({project:id,reason:error instanceof NetworkError?error.code:'project_unavailable'});continue;}
  const snapshot=await readProjectSnapshot(project,{...options,sourceMode:'none'});projects[id]={revision:snapshot.revision,integrity:snapshot.integrity,...await readConnectedReviewSummary(binding,id)};diagnostics.push(...snapshot.diagnostics);
  if(mode==='full'&&snapshot.integrity!=='pending_recovery'){
   const features=snapshot.features.slice(0,remaining);remaining-=features.length;featuresOmitted+=snapshot.features.length-features.length;
   Object.assign(freshness,await readConnectedFreshness(binding,features.map(f=>({project:id,feature:f.id})),options));
   const git=await readGitState(project);diagnostics.push(...git.diagnostics);const mapped=new Set([...snapshot.features,...snapshot.knowledge].flatMap(d=>documentSources(d).filter(r=>r.project===undefined||r.project===id).map(r=>r.path)));
   const paths=[...new Set([...git.staged,...git.unstaged,...git.untracked])].sort();let count=0;
   for(const path of paths){if(mapped.has(path)||await isIgnoredChange(project,path,options))continue;if(count++>=100){unknownChangesOmitted++;continue;}let review:'recorded'|'open'|'unknown'='unknown';try{const observed=await createSourceReader(binding,options)({project:id,path});review=await isConnectedUnmappedReviewed(binding,id,observed,options)?'recorded':'open';}catch{}unknownChanges.push({project:id,path,review});}
  }
 }
 return fit({mode,basis:mode==='full'?'fresh_snapshots':'last_known',coverage:'partial',projects,projectsUnexamined:unexamined,freshness,featuresOmitted,unknownChanges,unknownChangesOmitted,diagnostics,incomplete:!!unexamined.length||featuresOmitted>0||unknownChangesOmitted>0||Object.values(projects).some(p=>(p as {integrity:string}).integrity!=='valid')},budget);
}
export async function handleConnectedTool(name:ToolName,input:unknown,binding:ConnectionBinding,options:DocumentStorageOptions):Promise<CallToolResult>{
 options={...options,sourceReader:options.sourceReader??createSourceReader(binding,options)};
 if(name==='network_update')return update(binding,input,options);
 if(name==='network_check')return check(binding,input,options);
 if(name==='network_context'||name==='network_impact'){
  const schema=name==='network_context'?connectedContextSchema:connectedImpactSchema,parsed=schema.parse(input),budget=parsed.cursor?.parameters.budget??parsed.budget??12000;
  const opts={...options,responseReserveBytes:reserve,readFreshness:(refs:Parameters<typeof readConnectedFreshness>[1])=>readConnectedFreshness(binding,refs,options)};
  return fit(await (name==='network_context'?readConnectedContext:readConnectedImpact)(binding,JSON.parse(JSON.stringify(parsed)),opts),budget);
 }
 throw new NetworkError('unknown_tool','Not a connected tool');
}
