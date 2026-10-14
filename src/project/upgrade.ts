import { parseDocument } from 'yaml';
import type { Project } from './root.js';
import { NetworkError } from '../model/errors.js';
import { metaV2Schema } from '../model/v2.js';
import type { ProjectId } from '../model/identity.js';
import type { NetworkPath } from '../model/documents.js';
import type { UpdateResult } from '../storage/repository.js';
import { readProjectSnapshot, commitNetworkDocuments, documentSources, readLocalSource,validateProjectContents } from '../storage/documents.js';
import { digest, readStorage,readJournal,journalTarget,stableCapture,revision,fingerprints } from '../storage/journal.js';
export interface UpgradePlan {readonly phase:'upgrade'|'recovery';readonly receipt:string;readonly projectRoot:string;readonly identity:{id:ProjectId;name:string};readonly files:readonly {path:NetworkPath;expectedHash:string;content:string}[]}
interface Prepared {project:Project;revision:string;changes:Record<NetworkPath,string|null>;sources:Record<string,string>;journalHash?:string}
const plans=new WeakMap<UpgradePlan,Prepared>();
export async function planUpgrade(project:Project,identity:{id:ProjectId;name:string}):Promise<UpgradePlan>{
  const clean=metaV2Schema.parse({schema:2,coverage:'partial',project:identity}).project;
  const before=await readProjectSnapshot(project,{sourceMode:'none'});
  if(before.integrity==='pending_recovery')return planRecovery(project,clean);
  if(before.integrity!=='valid'||!before.meta)throw new NetworkError('invalid_network','Upgrade needs a valid initialized network');
  if(before.meta.schema===2&&before.meta.project.id!==identity.id)throw new NetworkError('conflict','Project identity already exists');
  const files:{path:NetworkPath;expectedHash:string;content:string}[]=[];const sources:Record<string,string>={};
  for(const feature of before.features)for(const ref of documentSources(feature))if(!ref.project)sources[ref.path]=await readLocalSource(project,ref.path);
  if(before.meta.schema===1)for(const [path,hash] of Object.entries(before.fingerprints)){
    const raw=await readStorage(project,path);if(raw===null||digest(raw)!==hash)throw new NetworkError('conflict','Network changed during upgrade preview');
    const doc=parseDocument(raw,{version:'1.2',schema:'core'});doc.set('schema',2);if(path==='network-spec/_meta.yaml')doc.set('project',clean);
    files.push({path:path as NetworkPath,expectedHash:hash,content:doc.toString()});
  }
  const changes=Object.fromEntries(files.map(f=>[f.path,f.content]));
  const receipt=digest(JSON.stringify([project.root,before.revision,clean,files,sources]));
  const plan:UpgradePlan=Object.freeze({phase:'upgrade',receipt,projectRoot:project.root,identity:Object.freeze(clean),files:Object.freeze(files.map(f=>Object.freeze(f)))});
  plans.set(plan,{project,revision:before.revision,changes,sources});return plan;
}
export async function applyUpgrade(plan:UpgradePlan):Promise<UpdateResult>{
  const prepared=plans.get(plan);if(!prepared)throw new NetworkError('invalid_upgrade','Use an exact in-process upgrade plan');
  return commitNetworkDocuments(prepared.project,prepared.revision,prepared.changes,{beforePublish:async()=>{
    if(prepared.journalHash!==undefined){const raw=await readStorage(prepared.project,'.feature-network/journal.json');if(raw!==null&&digest(raw)!==prepared.journalHash)throw new NetworkError('conflict','Recovery journal changed');}
    for(const [path,hash]of Object.entries(prepared.sources))if(await readLocalSource(prepared.project,path)!==hash)throw new NetworkError('conflict','Upgrade source changed',[path]);
  }});
}
export async function applyApprovedUpgrade(project:Project,identity:{id:ProjectId;name:string},receipt:string):Promise<UpdateResult>{
  const plan=await planUpgrade(project,identity);if(plan.receipt!==receipt)throw new NetworkError('conflict','Upgrade approval is stale');return applyUpgrade(plan);
}

/** Restart-safe, read-only recovery preview. A new receipt approves the actual
 * pending target; an old pre-crash receipt never silently authorizes a new plan. */
async function planRecovery(project:Project,identity:{id:ProjectId;name:string}):Promise<UpgradePlan>{
 const raw=await readStorage(project,'.feature-network/journal.json'),journal=await readJournal(project);
 if(raw===null||!journal||journal.version!==2)throw new NetworkError('pending_recovery','No versioned recovery plan is available');
 const current=await stableCapture(project),target=journalTarget(journal,current);
 const paths=Object.keys(journal.changes).sort();
 if(JSON.stringify(paths)!==JSON.stringify(Object.keys(journal.before).sort())||paths.some(path=>path.includes('/knowledge/')||journal.changes[path]===null))throw new NetworkError('invalid_upgrade','Journal is not a complete in-place upgrade');
 const snapshot=await validateProjectContents(project,target,{sourceMode:'none'});
 if(snapshot.integrity!=='valid'||snapshot.meta?.schema!==2||snapshot.meta.project.id!==identity.id||snapshot.meta.project.name!==identity.name)throw new NetworkError('conflict','Pending upgrade target differs from the requested identity');
 const sources:Record<string,string>={};
 for(const feature of snapshot.features)for(const ref of documentSources(feature))if(ref.project===undefined||ref.project===identity.id)sources[ref.path]=await readLocalSource(project,ref.path);
 const observed=fingerprints(current),files=paths.map(path=>({path:path as NetworkPath,expectedHash:observed[path]!,content:journal.changes[path]!}));
 const journalHash=digest(raw),targetRevision=revision(target),receipt=digest(JSON.stringify([project.root,targetRevision,identity,files,sources,journalHash]));
 const plan:UpgradePlan=Object.freeze({phase:'recovery',receipt,projectRoot:project.root,identity:Object.freeze({...identity}),files:Object.freeze(files.map(f=>Object.freeze(f)))});
 plans.set(plan,{project,revision:targetRevision,changes:{},sources,journalHash});return plan;
}
