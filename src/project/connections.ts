import { resolve } from 'node:path';
import { z } from 'zod';
import { stringify } from 'yaml';
import { parseYaml,validate } from '../model/schema.js';
import { projectIdSchema } from '../model/identity.js';
import type { ProjectId } from '../model/identity.js';
import { parseNetworkMeta } from '../model/documents.js';
import { NetworkError } from '../model/errors.js';
import type { Diagnostic } from '../model/types.js';
import { openProject,type Project } from './root.js';
import { readStorage,digest,atomicStorageWrite } from '../storage/journal.js';
import { withProjectLock } from '../storage/lock.js';
const registry='.feature-network/connections.yaml';
const configSchema=z.strictObject({schema:z.literal(1),learning:z.strictObject({enabled:z.boolean()}),projects:z.array(z.strictObject({id:projectIdSchema,root:z.string().min(1),readSources:z.boolean(),writeMemory:z.boolean()})).max(128)});
export type ConnectionsConfig=z.infer<typeof configSchema>;
export interface ConnectionEntry {readonly id:ProjectId;readonly root:string;readonly boundRoot:string|null;readonly readSources:boolean;readonly writeMemory:boolean}
export interface ConnectionBinding {readonly active:Project;readonly activeId:ProjectId;readonly revision:string;readonly learningEnabled:boolean;readonly entries:ReadonlyMap<ProjectId,ConnectionEntry>;readonly diagnostics:readonly Diagnostic[]}
interface Bound {raw:string|null;active:Project;activeId:ProjectId;entries:ReadonlyMap<ProjectId,ConnectionEntry>}
const bindings=new WeakMap<ConnectionBinding,Bound>();
const configs=new Map<string,ConnectionsConfig>();
export function parseConnections(text:string):ConnectionsConfig{let config=configs.get(text);if(!config){config=validate(configSchema,parseYaml(text,registry),registry);if(configs.size>=32)configs.delete(configs.keys().next().value!);configs.set(text,config);}return structuredClone(config);}
const identities=new Map<string,{raw:string;id:ProjectId}>();
async function identity(project:Project):Promise<ProjectId>{const raw=await readStorage(project,'network-spec/_meta.yaml',65536);if(raw===null)throw new NetworkError('not_initialized','Project marker missing');const old=identities.get(project.root);if(old?.raw===raw)return old.id;const meta=parseNetworkMeta(raw);if(meta.schema!==2)throw new NetworkError('schema_two_required','Connections need a persistent project identity');if(identities.size>=256)identities.delete(identities.keys().next().value!);identities.set(project.root,{raw,id:meta.project.id});return meta.project.id;}

async function selected(active:Project,activeId:ProjectId,config:ConnectionsConfig,strict:boolean):Promise<{entries:Map<ProjectId,ConnectionEntry>;diagnostics:Diagnostic[]}>{
 const entries=new Map<ProjectId,ConnectionEntry>([[activeId,Object.freeze({id:activeId,root:active.root,boundRoot:active.root,readSources:true,writeMemory:true})]]);const diagnostics:Diagnostic[]=[];
 for(const item of config.projects){
  if(entries.has(item.id))throw new NetworkError('ambiguous_project','A project identity is selected twice');
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(item.root))throw new NetworkError('unsafe_path','Remote URLs are not local connections');
  const root=resolve(active.root,item.root);let boundRoot:string|null=null;
  try{const project=await openProject(root);if(await identity(project)!==item.id)throw new NetworkError('project_identity_mismatch','Selected project identity differs');boundRoot=project.root;}
  catch(error){if(strict)throw error;diagnostics.push({code:error instanceof NetworkError?error.code:'project_unavailable',severity:'warning',message:'Selected project unavailable'});}
  entries.set(item.id,Object.freeze({...item,root,boundRoot}));
 }
 return {entries,diagnostics};
}
export async function readConnections(active:Project):Promise<ConnectionBinding>{
 const activeId=await identity(active);const raw=await readStorage(active,registry,65536);const config=raw===null?{schema:1 as const,learning:{enabled:false},projects:[]}:parseConnections(raw);
 const selection=await selected(active,activeId,config,false);const revision=digest(JSON.stringify([active.root,activeId,raw]));
 const binding:ConnectionBinding=Object.freeze({active,activeId,revision,learningEnabled:config.learning.enabled,entries:new Map(selection.entries),diagnostics:Object.freeze(selection.diagnostics)});
 bindings.set(binding,{raw,active,activeId,entries:selection.entries});return binding;
}
export async function assertConnection(binding:ConnectionBinding,id:ProjectId,operation:'read_memory'|'read_source'|'write_memory'):Promise<Project>{
 const privateBinding=bindings.get(binding);if(!privateBinding)throw new NetworkError('invalid_connection_binding','Use a fresh binding');
 if(await readStorage(privateBinding.active,registry,65536)!==privateBinding.raw||await identity(privateBinding.active)!==privateBinding.activeId)throw new NetworkError('connection_changed','Connection configuration changed');
 const entry=privateBinding.entries.get(id);if(!entry)throw new NetworkError('project_not_connected','Project not selected');
 if(operation==='read_source'&&!entry.readSources||operation==='write_memory'&&!entry.writeMemory)throw new NetworkError('permission_denied','Operation not selected for this project');
 let project:Project;try{project=await openProject(entry.root);}catch{throw new NetworkError('project_unavailable','Selected checkout not available');}
 if(entry.boundRoot!==null&&project.root!==entry.boundRoot)throw new NetworkError('connection_changed','Selected root changed');
 if(await identity(project)!==id)throw new NetworkError('project_identity_mismatch','Selected marker identity changed');
 return project;
}
export interface ConnectionsPlan {readonly receipt:string;readonly projectRoot:string;readonly config:ConnectionsConfig}
interface Prepared {active:Project;activeId:ProjectId;before:string|null;text:string;entries:ReadonlyMap<ProjectId,ConnectionEntry>}
const plans=new WeakMap<ConnectionsPlan,Prepared>();
export async function planConnections(active:Project,proposed:ConnectionsConfig,candidateHash?:string):Promise<ConnectionsPlan>{
 const config=configSchema.parse(proposed);const activeId=await identity(active);const before=await readStorage(active,registry,65536);const selection=await selected(active,activeId,config,true);const text=stringify(config);
 const receipt=digest(JSON.stringify([active.root,activeId,before,text,[...selection.entries.values()],candidateHash??digest(JSON.stringify(config))]));
 const preview=structuredClone(config);for(const entry of preview.projects)Object.freeze(entry);Object.freeze(preview.projects);Object.freeze(preview.learning);Object.freeze(preview);
 const plan=Object.freeze({receipt,projectRoot:active.root,config:preview});plans.set(plan,{active,activeId,before,text,entries:selection.entries});return plan;
}
export async function applyConnections(plan:ConnectionsPlan):Promise<void>{
 const p=plans.get(plan);if(!p)throw new NetworkError('invalid_connections_plan','Use the exact in-process plan');
 await withProjectLock(p.active,async()=>{
  const guard=async()=>{
   if(await readStorage(p.active,registry,65536)!==p.before||await identity(p.active)!==p.activeId)throw new NetworkError('conflict','Connection preview changed');
   for(const entry of p.entries.values()){const project=await openProject(entry.root);if(project.root!==entry.boundRoot||await identity(project)!==entry.id)throw new NetworkError('conflict','Selected checkout changed');}
  };
  await guard();if(p.text!==p.before)await atomicStorageWrite(p.active,registry,p.text,guard);
 });
}
