import { assertConnection,type ConnectionBinding } from '../project/connections.js';
import { readProjectSnapshot,type ProjectSnapshot,type DocumentStorageOptions } from '../storage/documents.js';
import type { ProjectId,FeatureRef } from '../model/identity.js';
import { featureKey } from '../model/identity.js';
import { NetworkError } from '../model/errors.js';
import { withWorkMeter,countWork } from '../diagnostics/work.js';
import { buildConnectedIndex,refreshConnectedIndex,knowledgeKey,type ConnectedIndex,type ConnectedEntity } from './connected-index.js';
import { tokenize,compare } from './index.js';
import { traverseImpact } from './traversal.js';
import { connectedState,paginateConnected,type ConnectedParameters,type ConnectedContextRequest,type ConnectedImpactRequest,type ConnectedFreshness,type ConnectedResult,type ConnectedRow,type ConnectedFrame } from './connected-pagination.js';
export type {ConnectedContextRequest,ConnectedImpactRequest,ConnectedFreshness,ConnectedResult} from './connected-pagination.js';
export interface ConnectedQueryOptions extends DocumentStorageOptions {readFreshness?:(refs:FeatureRef[])=>Promise<ConnectedFreshness>;responseReserveBytes?:number}
interface Session {snapshots:Map<ProjectId,ProjectSnapshot>;index?:ConnectedIndex}
const sessions=new Map<string,Session>();
export function invalidateConnectedCache(root:string):void{for(const key of sessions.keys())if(JSON.parse(key)[0]===root)sessions.delete(key);}
function projectSelection(binding:ConnectionBinding,parameters:ConnectedParameters,kind:'context'|'impact'):ProjectId[]{
 const explicit=[...(parameters.projects??[]),...(parameters.features??[]).map(r=>r.project),...(parameters.knowledge??[]).map(r=>r.project)];
 for(const id of explicit)if(!binding.entries.has(id))throw new NetworkError('project_not_connected','Explicit project is not registered');
 const connected=(parameters.scope??(kind==='impact'?'connected':'active'))==='connected';
 return [...new Set([binding.activeId,...explicit,...(connected?[...binding.entries.keys()].sort(compare):[])])];
}
function row(entity:ConnectedEntity,detail?:string):ConnectedRow{return {id:entity.key,project:entity.project,localId:entity.id,kind:entity.kind,summary:entity.summary,...(detail==='full'?{document:structuredClone(entity.document)}:{})};}
function rank(index:ConnectedIndex,binding:ConnectionBinding,parameters:ConnectedParameters,max:number,projectOrder:ProjectId[]):{keys:string[];limited:boolean}{
 const scores=new Map<string,number>();let limited=false;
 const add=(key:string,score:number)=>{const entity=index.entries.get(key);if(!entity)return;if(parameters.knowledgeTypes?.length&&('kind'in entity.document?!entity.document.statements.some(s=>parameters.knowledgeTypes!.includes(s.type)):true))return;if(!scores.has(key)&&scores.size>=max){limited=true;return;}scores.set(key,Math.max(scores.get(key)??0,score));};
 for(const ref of parameters.features??[])add(featureKey(ref),1000000);
 for(const id of parameters.ids??[])add(featureKey({project:binding.activeId,feature:id}),1000000);
 for(const ref of parameters.knowledge??[])add(knowledgeKey(ref.project,ref.knowledge),1000000);
 for(const path of parameters.paths??[])for(const key of index.paths.get(JSON.stringify([binding.activeId,path]))??[])add(key,100000);
 for(const term of new Set(tokenize(parameters.query??'')))for(const key of index.tokens.get(term)??[])add(key,(scores.get(key)??0)+1);
 if(!parameters.ids?.length&&!parameters.features?.length&&!parameters.knowledge?.length&&!parameters.paths?.length&&!parameters.query?.trim())for(const entity of [...index.entries.values()].sort((a,b)=>projectOrder.indexOf(a.project)-projectOrder.indexOf(b.project)||compare(a.key,b.key)))add(entity.key,0);
 return {keys:[...scores.keys()].sort((a,b)=>scores.get(b)!-scores.get(a)!||projectOrder.indexOf(index.entries.get(a)!.project)-projectOrder.indexOf(index.entries.get(b)!.project)||compare(a,b)),limited};
}
async function query(binding:ConnectionBinding,input:ConnectedContextRequest|ConnectedImpactRequest,kind:'context'|'impact',options:ConnectedQueryOptions):Promise<ConnectedResult>{
 return withWorkMeter(options.meter,async()=>{
  const state=connectedState(input,kind);const p=state.parameters,maxProjects=p.maxProjects??8,maxVisitedFeatures=p.maxVisitedFeatures??1000;
  if(kind==='impact'&&!p.features?.length&&!p.ids?.length&&!p.paths?.length&&!p.query?.trim())throw new NetworkError('invalid_query','Impact needs direct origins');
  await assertConnection(binding,binding.activeId,'read_memory');
  const freshSnapshots=kind==='impact'||!!state.cursor||p.freshness==='returned_features';
  const selected=projectSelection(binding,p,kind),chosen=selected.slice(0,maxProjects);const unexamined:{project:ProjectId;reason:string}[]=selected.slice(maxProjects).map(project=>({project,reason:'project_limit'}));
  const key=JSON.stringify([binding.active.root,binding.revision,[...(options.excludedReferenceRoots??[])].sort(),chosen]);
  let session=sessions.get(key);if(!session){if(sessions.size>=32)sessions.delete(sessions.keys().next().value!);session={snapshots:new Map()};sessions.set(key,session);}
  const snapshots=new Map<ProjectId,ProjectSnapshot>();
  for(const id of chosen){
   try{
    const project=await assertConnection(binding,id,'read_memory');
    const saved=session.snapshots.get(id);const snapshot=freshSnapshots||!saved?await readProjectSnapshot(project,{...options,sourceMode:'none'}):saved;
    if(['pending_recovery','not_initialized'].includes(snapshot.integrity))throw new NetworkError(snapshot.integrity,'Project snapshot not available');
    snapshots.set(id,snapshot);
   }catch(error){if(id===binding.activeId||error instanceof NetworkError&&error.code==='connection_changed')throw error;unexamined.push({project:id,reason:error instanceof NetworkError?error.code:'project_unavailable'});}
  }
  const index=session.index?refreshConnectedIndex(session.index,snapshots,binding.revision,options.meter):buildConnectedIndex(snapshots,binding.revision,options.meter);session.snapshots=snapshots;session.index=index;
  if(state.cursor&&(state.cursor.revision!==index.revision||state.cursor.registerRevision!==binding.revision||JSON.stringify(state.cursor.projects)!==JSON.stringify(selected)||JSON.stringify(state.cursor.revisions)!==JSON.stringify(index.revisions)))throw new NetworkError('stale_cursor','Connected snapshots changed');
  index.diagnostics=index.diagnostics.filter(d=>d.code!=='external_target_unresolved');
  for(const edges of index.outgoing.values())for(const edge of edges)if(!index.entries.has(edge.to))index.diagnostics.push({code:'external_target_unresolved',project:edge.fromRef.project,severity:'warning',message:'A relationship target was not resolved within the selected projects'});
  const ranked=rank(index,binding,p,maxVisitedFeatures,chosen);let rows:ConnectedRow[],featuresLimited=ranked.limited;let depthExtra:{}|{depth:number;depthLimited:boolean}={};
  if(kind==='impact'){
   const traversed=traverseImpact({...index,summary:id=>index.entries.get(id)!.summary},ranked.keys.filter(k=>index.entries.get(k)?.kind==='feature'),{depth:p.depth??2,direction:p.direction??'both',maxVisitedFeatures,...(options.meter?{meter:options.meter}:{})});
   rows=traversed.rows.map(r=>({...row(index.entries.get(r.id)!,p.detail),origin:r.origin,status:r.status,path:r.path}));featuresLimited ||= traversed.workLimited;depthExtra={depth:p.depth??2,depthLimited:traversed.depthLimited};
  }else{rows=ranked.keys.map(k=>row(index.entries.get(k)!,p.detail));for(const r of rows)if(r.kind==='feature')countWork('visitedFeatures');}
  const sourceFreshnessBasis=p.freshness??(kind==='impact'?'returned_features':'last_known');
  const frame:ConnectedFrame={revision:index.revision,registerRevision:binding.revision,revisions:index.revisions,coverage:'partial',integrity:index.diagnostics.some(d=>d.severity==='error')?'invalid':'valid',incomplete:unexamined.length>0||featuresLimited||index.diagnostics.some(d=>d.severity==='error'||d.code==='external_target_unresolved'),projectsExamined:[...snapshots.keys()],projectsUnexamined:unexamined,projects:Object.fromEntries([...snapshots].map(([id,s])=>[id,{name:s.meta?.schema===2?s.meta.project.name:id,revision:s.revision,fingerprints:{}}])),basis:freshSnapshots?'fresh_snapshots':'last_known',sourceFreshnessBasis,sourceValidationScope:sourceFreshnessBasis==='returned_features'?'returned_features':'none',limits:{maxProjects,maxVisitedFeatures,projectsLimited:unexamined.some(p=>p.reason==='project_limit'),featuresLimited},unexaminedMatchCount:unexamined.length||featuresLimited?null:0,selectedProjects:selected,...depthExtra};
  const preliminary=paginateConnected(index,rows,p,kind,frame,state.cursor,undefined,options.responseReserveBytes);
  if(sourceFreshnessBasis==='last_known')return preliminary;
  if(!options.readFreshness)throw new NetworkError('freshness_unavailable','A current source check provider is required');
  const refs=[...new Set(preliminary.items.map(r=>r.id))].map(k=>index.entries.get(k)).filter((e):e is ConnectedEntity=>e?.kind==='feature').map(e=>({project:e.project,feature:e.id}));
  const freshness=await options.readFreshness(refs);
  for(const [id,snapshot] of snapshots){const project=await assertConnection(binding,id,'read_memory');const current=await readProjectSnapshot(project,{...options,sourceMode:'none'});if(current.revision!==snapshot.revision||current.integrity==='pending_recovery')throw new NetworkError(state.cursor?'stale_cursor':'conflict','Network changed during source observation');}
  return paginateConnected(index,rows,p,kind,frame,state.cursor,freshness,options.responseReserveBytes);
 });
}
export const readConnectedContext=(binding:ConnectionBinding,request:ConnectedContextRequest={},options:ConnectedQueryOptions={}):Promise<ConnectedResult>=>query(binding,request,'context',options);
export const readConnectedImpact=(binding:ConnectionBinding,request:ConnectedImpactRequest={},options:ConnectedQueryOptions={}):Promise<ConnectedResult>=>query(binding,request,'impact',options);
