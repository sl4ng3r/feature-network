import type { ProjectSnapshot } from '../storage/documents.js';
import { documentPath, type EditableDocument } from '../model/documents.js';
import type { FeatureRef,ProjectId,RevisionSet } from '../model/identity.js';
import { featureKey } from '../model/identity.js';
import type { Diagnostic } from '../model/types.js';
import type { SourceRef } from '../model/identity.js';
import type { TraversalEdge } from './traversal.js';
import { tokenize,compare } from './index.js';
import { digest } from '../storage/journal.js';
import { countWork,withWorkMeter,type WorkMeter } from '../diagnostics/work.js';
export interface ConnectedEntity {key:string;project:ProjectId;kind:'feature'|'knowledge';id:string;summary:string;document:EditableDocument;fingerprint:string;path:string}
export interface ConnectedEdge extends TraversalEdge {type:'depends_on'|'reads'|'writes';fromRef:FeatureRef;toRef:FeatureRef;evidence:SourceRef[];when?:string|undefined;check?:string|undefined}
export interface ConnectedIndex {
 revision:string;registerRevision:string;revisions:RevisionSet;entries:Map<string,ConnectedEntity>;
 tokens:Map<string,Set<string>>;paths:Map<string,Set<string>>;outgoing:Map<string,ConnectedEdge[]>;incoming:Map<string,ConnectedEdge[]>;
 diagnostics:(Diagnostic & {project?:ProjectId})[];
}
export const knowledgeKey=(project:ProjectId,id:string)=>JSON.stringify([project,'knowledge',id]);
function postings(map:Map<string,Set<string>>,keys:Iterable<string>,id:string,add:boolean){for(const key of keys){const values=new Set(map.get(key));if(add)values.add(id);else values.delete(id);if(values.size)map.set(key,values);else map.delete(key);}}
function entryTokens(entity:ConnectedEntity):Set<string>{const d=entity.document;return new Set(tokenize([d.id,d.summary,...('kind'in d?d.statements.map(s=>s.text):d.key_points)].join(' ')));}
function entryPaths(entity:ConnectedEntity):Set<string>{const d=entity.document;const refs:SourceRef[]='kind'in d?d.statements.flatMap(s=>s.evidence):[...d.code,...d.evidence,...d.relations.flatMap(r=>r.evidence),...d.hypotheses.flatMap(h=>h.evidence)];return new Set(refs.map(r=>JSON.stringify([r.project??entity.project,r.path])));}
function remove(index:ConnectedIndex,entity:ConnectedEntity){
 postings(index.tokens,entryTokens(entity),entity.key,false);postings(index.paths,entryPaths(entity),entity.key,false);
 for(const edge of index.outgoing.get(entity.key)??[]){const incoming=(index.incoming.get(edge.to)??[]).filter(e=>e.from!==entity.key);if(incoming.length)index.incoming.set(edge.to,incoming);else index.incoming.delete(edge.to);}
 index.outgoing.delete(entity.key);index.entries.delete(entity.key);
}
function insert(index:ConnectedIndex,entity:ConnectedEntity){
 index.entries.set(entity.key,entity);postings(index.tokens,entryTokens(entity),entity.key,true);postings(index.paths,entryPaths(entity),entity.key,true);
 const d=entity.document;if('kind'in d)return;
 const edges:ConnectedEdge[]=d.relations.map(relation=>{
  const fromRef={project:entity.project,feature:entity.id},toRef=typeof relation.to==='string'?{project:entity.project,feature:relation.to}:relation.to;
  return {...relation,from:entity.key,to:featureKey(toRef),fromRef,toRef};
 });
 index.outgoing.set(entity.key,edges);for(const edge of edges)index.incoming.set(edge.to,[...(index.incoming.get(edge.to)??[]),edge]);
}
export function buildConnectedIndex(snapshots:ReadonlyMap<ProjectId,ProjectSnapshot>,registerRevision:string,meter?:WorkMeter):ConnectedIndex{
 const empty:ConnectedIndex={revision:'',registerRevision,revisions:{},entries:new Map(),tokens:new Map(),paths:new Map(),outgoing:new Map(),incoming:new Map(),diagnostics:[]};
 return refreshConnectedIndex(empty,snapshots,registerRevision,meter);
}
export function refreshConnectedIndex(previous:ConnectedIndex,snapshots:ReadonlyMap<ProjectId,ProjectSnapshot>,registerRevision:string,meter?:WorkMeter):ConnectedIndex{
 return withWorkMeter(meter,()=>{
  const revisions:Record<string,string>={};const wanted=new Map<string,ConnectedEntity>();const diagnostics:ConnectedIndex['diagnostics']=[];
  for(const [project,snapshot]of [...snapshots].sort(([a],[b])=>compare(a,b))){
   revisions[project]=snapshot.revision;diagnostics.push(...snapshot.diagnostics.map(d=>({...d,project})));
   if(snapshot.meta?.schema!==2||snapshot.meta.project.id!==project){diagnostics.push({code:'project_identity_mismatch',severity:'error',project,message:'Snapshot identity does not match binding'});continue;}
   for(const doc of [...snapshot.features,...snapshot.knowledge]){
    const kind='kind'in doc?'knowledge':'feature';const path=documentPath(doc),fingerprint=snapshot.fingerprints[path];if(!fingerprint)continue;
    const key=kind==='feature'?featureKey({project,feature:doc.id}):knowledgeKey(project,doc.id);
    const old=previous.entries.get(key);wanted.set(key,old?.fingerprint===fingerprint?old:{key,project,kind,id:doc.id,summary:doc.summary,document:structuredClone(doc),fingerprint,path});
   }
  }
  const index:ConnectedIndex={registerRevision,revisions,revision:digest(JSON.stringify([registerRevision,revisions])),entries:new Map(previous.entries),tokens:new Map(previous.tokens),paths:new Map(previous.paths),outgoing:new Map(previous.outgoing),incoming:new Map(previous.incoming),diagnostics};
  for(const [key,entry]of previous.entries)if(wanted.get(key)!==entry){remove(index,entry);if(!wanted.has(key))countWork('indexReplacements');}
  for(const [key,entry]of wanted)if(previous.entries.get(key)!==entry){insert(index,entry);countWork('indexReplacements');}
  return index;
 });
}
