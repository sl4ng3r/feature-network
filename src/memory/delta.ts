import { parseNetworkDocument,documentPath,editablePathSchema,type EditableDocument,type EditablePath } from '../model/documents.js';
import type { SourceObservation,ProjectId } from '../model/identity.js';
import type { ProjectSnapshot,DocumentUpdate } from '../storage/documents.js';
import { NetworkError } from '../model/errors.js';
import { digest } from '../storage/journal.js';
export interface PreparedDelta {project:ProjectId;update:DocumentUpdate;reason:string;changedPaths:EditablePath[];changeDigest:string}
const withoutDate=(value:unknown):string=>JSON.stringify(value,(key,item)=>key==='recorded_on'?undefined:item);
export function prepareMemoryDelta(snapshot:ProjectSnapshot,proposed:EditableDocument[],sources:SourceObservation[],reason:string,deletes:EditablePath[]=[]):PreparedDelta|null{
 if(snapshot.meta?.schema!==2)throw new NetworkError('schema_two_required','Memory deltas require schema two');
 if(snapshot.integrity==='pending_recovery')throw new NetworkError('pending_recovery','Read a recovered snapshot first');
 if(!reason.trim()||reason.length>8192)throw new NetworkError('invalid_decision','A bounded reason is required');
 const project=snapshot.meta.project.id;const old=new Map([...snapshot.features,...snapshot.knowledge].map(d=>[documentPath(d),d]));const changed=new Map<EditablePath,EditableDocument>();const seen=new Set<EditablePath>();
 for(const proposal of proposed){
  const path=documentPath(proposal);if(seen.has(path)||deletes.includes(path))throw new NetworkError('invalid_update','Duplicate or overlapping memory change');seen.add(path);
  const parsed=parseNetworkDocument(JSON.stringify(proposal),path);if(!('id'in parsed)||parsed.schema!==2)throw new NetworkError('invalid_update','Schema two editable document required');
  const previous=old.get(path);
  if('kind'in parsed&&previous&&'kind'in previous){
   const nextIds=new Set(parsed.statements.map(s=>s.id));if(previous.statements.some(s=>!nextIds.has(s.id)))throw new NetworkError('invalid_update','Preserve existing statements; use explicit supersession or retraction');
   for(const statement of parsed.statements){const prior=previous.statements.find(s=>s.id===statement.id);if(!prior)continue;
    if(prior.type==='requirement'&&(statement.type!==prior.type||statement.text!==prior.text))throw new NetworkError('invalid_update','Changed requirements need a new statement with supersedes');
    if(statement.state==='superseded'&&prior.state!=='superseded'&&!parsed.statements.some(s=>s.id!==statement.id&&s.supersedes.some(r=>r.project===project&&r.knowledge===parsed.id&&r.statement===statement.id)))throw new NetworkError('invalid_update','Supersession needs its replacement statement');
    if(withoutDate(statement)===withoutDate(prior))statement.origin.recorded_on=prior.origin.recorded_on;
   }
  }
  if(!previous||JSON.stringify(parsed)!==JSON.stringify(previous))changed.set(path,parsed);
 }
 const removed=[...new Set(deletes)].filter(path=>{if(!editablePathSchema.safeParse(path).success)throw new NetworkError('invalid_update','Not an editable memory path');const document=old.get(path);if(document&&'kind'in document&&document.statements.some(s=>s.type==='requirement'&&s.state==='active'))throw new NetworkError('invalid_update','Retract or supersede active requirements before removing their document');return snapshot.fingerprints[path]!==undefined;}).sort();
 const paths=[...changed.keys(),...removed].sort();if(!paths.length)return null;
 const update:DocumentUpdate={expectedRevision:snapshot.revision,expected:Object.fromEntries(paths.map(path=>[path,snapshot.fingerprints[path]??null])),upserts:[...changed].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,doc])=>doc),deletes:removed,sources:structuredClone(sources).sort((a,b)=>(a.project<b.project?-1:a.project>b.project?1:0)||(a.path<b.path?-1:a.path>b.path?1:0))};
 const result={project,update,reason:reason.trim(),changedPaths:paths};return {...result,changeDigest:digest(JSON.stringify(result))};
}
