import { lstat } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { stringify } from 'yaml';
import type { Project } from '../project/root.js';
import type { Diagnostic } from '../model/types.js';
import type { FeatureDocument, EditableDocument, MetaV1, NetworkPath, EditablePath } from '../model/documents.js';
import { parseNetworkDocument, networkPathSchema, editablePathSchema, documentPath } from '../model/documents.js';
import type { KnowledgeDocument, MetaV2 } from '../model/v2.js';
import type { SourceRef, QualifiedSourceRef, SourceObservation } from '../model/identity.js';
import { statementKey } from '../model/identity.js';
import { NetworkError } from '../model/errors.js';
import { countWork, withWorkMeter, type WorkMeter } from '../diagnostics/work.js';
import type { Snapshot, StorageOptions, UpdateResult } from './repository.js';
import { readReferenceHash } from './sources.js';
import { withProjectLock, storagePath, isMissing } from './lock.js';
import { stableCapture, revision, fingerprints, digest, readJournal, journalTarget, saveJournal, finishJournal, hasJournal, type Contents } from './journal.js';
import type { ByteCache } from './regular.js';
import { resolveProjectPath, isSensitivePath, isAutomaticGeneratedPath } from '../project/paths.js';
export type SourceReader = (ref: QualifiedSourceRef) => Promise<SourceObservation>;
export interface DocumentStorageOptions extends StorageOptions { sourceReader?:SourceReader; meter?:WorkMeter; beforePublish?:()=>Promise<void> }
export interface ProjectSnapshot {
  meta:MetaV1|MetaV2|null; features:FeatureDocument[]; knowledge:KnowledgeDocument[];
  revision:string; fingerprints:Record<string,string>; diagnostics:Diagnostic[]; integrity:Snapshot['integrity'];
  validation:{structure:'checked';sources:'all'|'none'};
}
export interface DocumentUpdate {expectedRevision:string;expected:Record<string,string|null>;upserts:EditableDocument[];deletes:EditablePath[];sources:SourceObservation[]}
interface DocumentCache { bytes:ByteCache; parsed:Map<string,{hash:string;document:ReturnType<typeof parseNetworkDocument>}> }
const caches = new Map<string,DocumentCache>();
function cacheFor(project:Project, options:StorageOptions):DocumentCache {
  const key = JSON.stringify([2,project.root,[...(options.excludedReferenceRoots??[])].sort()]);
  let cache = caches.get(key);
  if (!cache) { if(caches.size>=32)caches.delete(caches.keys().next().value!);cache={bytes:new Map(),parsed:new Map()};caches.set(key,cache); }
  return cache;
}
export function documentSources(document:EditableDocument):SourceRef[] {
  if ('kind' in document) return document.statements.flatMap(s=>s.evidence);
  return [...document.code,...document.evidence,...document.hypotheses.flatMap(h=>h.evidence),...document.relations.flatMap(r=>r.evidence)];
}
export async function readLocalSource(project:Project, path:string, options:StorageOptions = {}):Promise<string> {
  const canonical = relative(project.root,await resolveProjectPath(project,path)).split(sep).join('/');
  if ([path,canonical].some(p=>isSensitivePath(p)||isAutomaticGeneratedPath(p))) throw new NetworkError('unsafe_reference','Excluded source',[path]);
  return readReferenceHash(project,path,options);
}
function failure(error:unknown,path:string):Diagnostic {
  return {code:error instanceof NetworkError?error.code:isMissing(error)?'missing_reference':'unreadable_reference',path,severity:'error',message:'Document or source could not be validated'};
}
export async function validateProjectContents(project:Project,contents:Contents,options:DocumentStorageOptions & {sourceMode?:'all'|'none'} = {},cache?:DocumentCache):Promise<ProjectSnapshot> {
  const result:ProjectSnapshot={meta:null,features:[],knowledge:[],revision:revision(contents),fingerprints:fingerprints(contents),diagnostics:[],integrity:'valid',validation:{structure:'checked',sources:options.sourceMode??'all'}};
  for (const [path,bytes] of Object.entries(contents)) {
    try {
      const hash = digest(bytes); const old=cache?.parsed.get(path);
      let doc = old?.hash===hash ? structuredClone(old.document) : undefined;
      if(!doc){doc=parseNetworkDocument(new TextDecoder('utf-8',{fatal:true}).decode(bytes),path as NetworkPath);cache?.parsed.set(path,{hash,document:doc});}
      if(path==='network-spec/_meta.yaml' && !('id' in doc))result.meta=doc;
      else if('kind' in doc)result.knowledge.push(doc);
      else if('id' in doc)result.features.push(doc);
    }catch(error){result.diagnostics.push(failure(error,path));}
  }
  if (!result.meta) result.diagnostics.push({code:'not_initialized',path:'network-spec/_meta.yaml',severity:'error',message:'A valid marker is required'});
  const meta=result.meta; const own=meta?.schema===2?meta.project.id:undefined;
  const ids = new Set(result.features.map(f=>f.id));
  const docs:EditableDocument[]=[...result.features,...result.knowledge];
  for(const doc of docs){
    const path=documentPath(doc);
    if(doc.schema!==meta?.schema)result.diagnostics.push({code:'mixed_schema',path,severity:'error',message:'Document and marker versions differ'});
    if(!('kind' in doc))for(const relation of doc.relations){
      const target=typeof relation.to==='string'?{project:own,feature:relation.to}:relation.to;
      if(target.project===own){if(!ids.has(target.feature))result.diagnostics.push({code:'missing_target',path,severity:'error',message:'Local feature target is missing'});}
      else result.diagnostics.push({code:'external_target_unresolved',path,severity:'warning',message:'External target requires a connected snapshot'});
    }
    if(options.sourceMode!=='none')for(const ref of documentSources(doc)){
      try{
        if(ref.project!==undefined && ref.project!==own){
          if(!options.sourceReader)throw new NetworkError('external_source_unavailable','External source not connected');
          const observed=await options.sourceReader({...ref,project:ref.project});
          if(!('hash' in observed))throw new NetworkError('missing_reference','External source is missing');
        } else await readLocalSource(project,ref.path,options);
      }catch(error){const diagnostic=failure(error,path);if(ref.project!==undefined&&ref.project!==own)diagnostic.severity='warning';result.diagnostics.push(diagnostic);}
    }
  }
  if(own){
    const links=new Map<string,string[]>();
    for(const doc of result.knowledge)for(const statement of doc.statements){
      const key=statementKey({project:own,knowledge:doc.id,statement:statement.id});
      links.set(key,statement.supersedes.filter(r=>r.project===own).map(statementKey));
    }
    const active=new Set<string>();const done=new Set<string>();
    const visit=(key:string):boolean=>{if(active.has(key))return true;if(done.has(key))return false;active.add(key);for(const target of links.get(key)??[])if(visit(target))return true;active.delete(key);done.add(key);return false;};
    if([...links.keys()].some(visit))result.diagnostics.push({code:'supersedes_cycle',severity:'error',message:'Supersession cannot contain cycles'});
  }
  if(result.diagnostics.some(d=>d.severity==='error'))result.integrity='invalid';
  return result;
}
export async function readProjectSnapshot(project:Project,options:DocumentStorageOptions & {sourceMode?:'all'|'none'} = {}):Promise<ProjectSnapshot>{
  return withWorkMeter(options.meter,async()=>{
    try{await lstat(await storagePath(project,'network-spec/_meta.yaml'));}catch(error){if(!isMissing(error))throw error;const result=await validateProjectContents(project,{},options);result.integrity='not_initialized';return result;}
    const cache=cacheFor(project,options);
    const contents=await withProjectLock(project,async()=>await hasJournal(project)?null:stableCapture(project,cache.bytes));
    if(contents===null){const result=await validateProjectContents(project,{},options);result.integrity='pending_recovery';return result;}
    return validateProjectContents(project,contents,options,cache);
  });
}
async function recover(project:Project,options:DocumentStorageOptions):Promise<boolean>{
  const pending=await readJournal(project);if(!pending)return false;
  const target=journalTarget(pending,await stableCapture(project));
  const valid=await validateProjectContents(project,target,{...options,sourceMode:'all'});
  if(valid.integrity!=='valid')throw new NetworkError('pending_recovery','Recovered network would be invalid');
  await finishJournal(project,pending,options.beforePublish);return true;
}
/** Authorized writers may finish a validated journal; readers never call this. */
export async function recoverDocumentJournal(project:Project,options:DocumentStorageOptions={}):Promise<boolean>{
 return withWorkMeter(options.meter,()=>withProjectLock(project,()=>recover(project,options)));
}
/** Internal marker-capable transaction. Guard is trusted Core code, never JSON. */
export async function commitNetworkDocuments(project:Project,expectedRevision:string,changes:Record<NetworkPath,string|null>,options:DocumentStorageOptions = {}):Promise<UpdateResult>{
  return withWorkMeter(options.meter,()=>withProjectLock(project,async()=>{
    const recovered=await recover(project,options);const before=await stableCapture(project);
    if(revision(before)!==expectedRevision)throw new NetworkError('conflict','Network revision changed');
    const after={...before};const actual:Record<string,string|null>={};
    for(const [path,text] of Object.entries(changes)){
      if(!networkPathSchema.safeParse(path).success)throw new NetworkError('invalid_update','Unknown network document path',[path]);
      if(text===null)delete after[path];else {parseNetworkDocument(text,path as NetworkPath);after[path]=Buffer.from(text);}
      if((before[path]===undefined?null:digest(before[path]!))!==(text===null?null:digest(text)))actual[path]=text;
    }
    const validation=await validateProjectContents(project,after,{...options,sourceMode:'all'});
    if(validation.integrity!=='valid')throw new NetworkError('invalid_network','Complete end state is invalid',validation.diagnostics.filter(d=>d.severity==='error').flatMap(d=>d.path?[d.path]:[]));
    if(options.beforePublish)await options.beforePublish();
    if(revision(await stableCapture(project))!==revision(before))throw new NetworkError('conflict','Network changed during validation');
    if(Object.keys(actual).length){const journal={version:2 as const,before:fingerprints(before),changes:actual};await saveJournal(project,journal);await finishJournal(project,journal,options.beforePublish);}
    return {revision:revision(after),fingerprints:fingerprints(after),diagnostics:validation.diagnostics,recovered};
  }));
}
export async function applyDocumentUpdate(project:Project,request:DocumentUpdate,options:DocumentStorageOptions = {}):Promise<UpdateResult>{
  return withWorkMeter(options.meter,async()=>{
    let before=await readProjectSnapshot(project,{...options,sourceMode:'none'});
    if(before.integrity==='pending_recovery'){await recoverDocumentJournal(project,options);before=await readProjectSnapshot(project,{...options,sourceMode:'none'});}
    if(before.revision!==request.expectedRevision)throw new NetworkError('conflict','Network revision changed');
    const own=before.meta?.schema===2?before.meta.project.id:undefined;
    if(!own)throw new NetworkError('schema_two_required','Versioned updates need schema two');
    for(const [path,hash] of Object.entries(request.expected)){
      if(!networkPathSchema.safeParse(path).success || (hash!==null&&!/^[a-f0-9]{64}$/.test(hash)))throw new NetworkError('invalid_update','Invalid fingerprint');
      if((before.fingerprints[path]??null)!==hash)throw new NetworkError('conflict','Document fingerprint changed',[path]);
    }
    const changes:Record<NetworkPath,string|null>={};
    for(const doc of request.upserts){const path=documentPath(doc);if(Object.hasOwn(changes,path))throw new NetworkError('invalid_update','Duplicate document');changes[path]=stringify(doc);}
    for(const path of request.deletes){if(!editablePathSchema.safeParse(path).success||Object.hasOwn(changes,path))throw new NetworkError('invalid_update','Invalid or overlapping deletion');changes[path]=null;}
    for(const path of Object.keys(changes))if(!Object.hasOwn(request.expected,path))throw new NetworkError('invalid_update','Changed documents need expected fingerprints',[path]);
    const verify=async()=>{
      if(options.beforePublish)await options.beforePublish();
      for(const doc of request.upserts){
       const prior=before.knowledge.find(k=>documentPath(k)===documentPath(doc));
       const refs='kind'in doc&&prior?doc.statements.filter(statement=>{const old=prior.statements.find(s=>s.id===statement.id);return !old||JSON.stringify(old)!==JSON.stringify(statement);}).flatMap(s=>s.evidence):documentSources(doc);
       for(const ref of refs){
        const id=ref.project??own;const supplied=request.sources.find(s=>s.project===id&&s.path===ref.path&&'hash'in s);
        if(!supplied||!('hash'in supplied))throw new NetworkError('unverified_reference','Upsert source was not inspected',[ref.path]);
        const actual=id===own?{hash:await readLocalSource(project,ref.path,options)}:await options.sourceReader?.({...ref,project:id});
        if(!actual||!('hash'in actual)||actual.hash!==supplied.hash)throw new NetworkError('conflict','Inspected source changed',[ref.path]);
       }
      }
    };
    return commitNetworkDocuments(project,request.expectedRevision,changes,{...options,beforePublish:verify});
  });
}
