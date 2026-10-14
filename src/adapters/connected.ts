import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {classifyCommand} from '../commands/policy.js';
import {memoryPolicy} from '../memory/policy.js';
import {readConnections,assertConnection,type ConnectionBinding} from '../project/connections.js';
import {createSourceReader} from '../project/source-access.js';
import {readGitState,readCommittedChanges} from '../project/git.js';
import {isSensitivePath} from '../project/paths.js';
import type {Project} from '../project/root.js';
import {isIgnoredChange} from '../freshness/references.js';
import {readConnectedFreshness,isConnectedUnmappedReviewed} from '../freshness/connected.js';
import {readProjectSnapshot,documentSources} from '../storage/documents.js';
import {readRuntime,writeRuntime,runtimeRevision} from '../storage/runtime.js';
import {digest,hasJournal} from '../storage/journal.js';
import {NetworkError} from '../model/errors.js';
import {bootstrap} from '../bootstrap/state.js';
import type {AdapterOptions,HostOutput} from './codex.js';
const id=z.string().min(1).max(128),hash=z.string().regex(/^[a-f0-9]{64}$/);
const receipt=z.strictObject({version:z.literal(1),sessionId:id,hostTurnId:id,coreTurnId:z.uuid(),registerRevision:hash,mode:z.enum(['init','sync','unspecified']),continued:z.boolean(),head:z.string().nullable(),branch:z.string().nullable(),observed:z.record(z.string(),hash.nullable()).refine(v=>Object.keys(v).length<=100)});
const context=(event:string,text:string):HostOutput=>({hookSpecificOutput:{hookEventName:event,additionalContext:text}});
/** Metadata-only hint: never inject a graph or conversation/source content. */
export async function connectedHostHint(project:Project):Promise<string>{
 const binding=await readConnections(project),pending=await hasJournal(project);
 return `FeatureNetwork: schema 2, learning ${binding.learningEnabled?'enabled':'disabled'}; ${binding.entries.size} locally registered project(s), last_known, partial coverage${pending?', pending recovery':''}. Use the feature-network skill and five MCP tools. Conversation and existing analysis learning belongs in the active skill; hooks never interpret prompts or perform full analysis. Explicit read commands stay read-only. Continue the user's authorized coding and testing task. No host or connection installation is automatic.`;
}
async function paths(project:Project,input:string[],options:{excludedReferenceRoots:string[]}):Promise<string[]>{
 const result:string[]=[];for(const path of [...new Set(input)].sort())if(!isSensitivePath(path)&&!await isIgnoredChange(project,path,options))result.push(path);return result;
}
async function observe(binding:ConnectionBinding,path:string,options:{excludedReferenceRoots:string[]}):Promise<string|null>{const source=await createSourceReader(binding,options)({project:binding.activeId,path});return 'hash'in source?source.hash:null;}
/** Only Git-observed source changes can support the one-shot host continuation.
 * Baseline work is bounded to existing dirty sources; clean graph sources are not scanned. */
export async function handleConnectedCodex(project:Project,payload:unknown,trusted:AdapterOptions):Promise<HostOutput>{
 const event=z.object({session_id:id,turn_id:id.optional(),hook_event_name:z.enum(['SessionStart','UserPromptSubmit','Stop']),prompt:z.string().max(262144).optional(),stop_hook_active:z.boolean().optional()}).parse(payload);
 if(event.hook_event_name==='SessionStart')return context('SessionStart',await connectedHostHint(project));
 if(!event.turn_id)return {};
 const options={excludedReferenceRoots:[trusted.pluginRoot],allowRecovery:false},binding=await readConnections(project),key=`hooks/codex-connected/${digest(event.session_id)}`;
 if(event.hook_event_name==='UserPromptSubmit'){
  if(event.prompt===undefined)return {};const mode=classifyCommand(event.prompt),policy=memoryPolicy({enabled:binding.learningEnabled,mode,explicitReadOnly:false,basis:'development'});
  if(!policy.writeMemory)return {};
  if(await hasJournal(project))return {};
  const prior=await readRuntime(project,key),old=receipt.safeParse(prior);if(old.success&&old.data.hostTurnId===event.turn_id)return {};
  const git=await readGitState(project);if(git.status!=='available')return context('UserPromptSubmit',await connectedHostHint(project));
  const changed=await paths(project,[...git.staged,...git.unstaged,...git.untracked],options);if(changed.length>100)return context('UserPromptSubmit',await connectedHostHint(project));
  const observed:Record<string,string|null>={};for(const path of changed)observed[path]=await observe(binding,path,options);
  const state={version:1,sessionId:event.session_id,hostTurnId:event.turn_id,coreTurnId:randomUUID(),registerRevision:binding.revision,mode,continued:false,head:git.head,branch:git.branch,observed};
  await writeRuntime(project,key,prior===null?null:runtimeRevision(prior),state,options,async()=>{await assertConnection(binding,binding.activeId,'read_memory');});
  return context('UserPromptSubmit',`FeatureNetwork: bounded source-turn baseline captured. Continue the user's authorized coding and testing task. Conversation or no-code analysis learning belongs in the active feature-network skill when enabled; never fabricate source confirmation. Read commands remain read-only. Only new source changes in this bound turn can support one extra memory-only continuation; never process old backlog.`);
 }
 if(event.stop_hook_active!==false||await hasJournal(project))return {};
 const raw=await readRuntime(project,key),parsed=receipt.safeParse(raw);if(!parsed.success)return {};const state=parsed.data;
 if(state.sessionId!==event.session_id||state.hostTurnId!==event.turn_id||state.continued||state.registerRevision!==binding.revision)return {};
 if(!memoryPolicy({enabled:binding.learningEnabled,mode:state.mode,explicitReadOnly:false,basis:'development'}).writeMemory)return {};
 const git=await readGitState(project);if(git.status!=='available'||git.branch!==state.branch)return {};
 let changed=[...git.staged,...git.unstaged,...git.untracked];
 if(git.head!==state.head){if(!git.head)return {};const committed=await readCommittedChanges(project,state.head,git.head);if(committed.status!=='available')return {};changed.push(...committed.paths);}
 const candidates=await paths(project,[...changed,...Object.keys(state.observed)],options);if(candidates.length>100)return {};
 const actual:Record<string,string|null>={},newPaths:string[]=[];
 for(const path of candidates){const hash=await observe(binding,path,options);actual[path]=hash;if(Object.hasOwn(state.observed,path)?state.observed[path]!==hash:changed.includes(path))newPaths.push(path);}
 let reason:string;
 if(state.mode==='init'){
  const run=await bootstrap(project,{action:'status'},options);if(!['pending','needs_review','awaiting_relational_review'].includes(run.status))return {};
  reason='Continue the explicitly requested feature-network-init with one bounded active-project package or relationship review. Preserve knowledge and manual points; no product edits, no backlog sweep. Report partial coverage.';
 }else{
  if(!newPaths.length)return {};
  const snapshot=await readProjectSnapshot(project,{...options,sourceMode:'none'});if(snapshot.integrity!=='valid')return {};
  const affected=snapshot.features.filter(f=>documentSources(f).some(s=>(s.project===undefined||s.project===binding.activeId)&&newPaths.includes(s.path)));
  const fresh=await readConnectedFreshness(binding,affected.map(f=>({project:binding.activeId,feature:f.id})),options);
  const mapped=new Set(affected.flatMap(f=>documentSources(f).filter(s=>s.project===undefined||s.project===binding.activeId).map(s=>s.path)));
  let open=Object.values(fresh).filter(s=>s.review!=='recorded').length;
  for(const path of newPaths.filter(p=>!mapped.has(p))){const source=actual[path]===null?{project:binding.activeId,path,state:'missing' as const}:{project:binding.activeId,path,hash:actual[path]!};if(!await isConnectedUnmappedReviewed(binding,binding.activeId,source,options))open++;}
  if(!open)return {};
  reason=`FeatureNetwork: ${open} current-turn source review(s) remain open. Use network_context summaries, selected full details and network_check full; inspect only the new turn paths already handled in the task. Publish grouped kind:memory deltas or source-backed no_semantic_change reviews. No product edits or old backlog in this memory-only continuation. Report unresolved evidence after this single continuation.`;
 }
 await writeRuntime(project,key,runtimeRevision(raw),{...state,continued:true},options,async()=>{await assertConnection(binding,binding.activeId,'read_memory');for(const path of newPaths)if(await observe(binding,path,options)!==actual[path])throw new NetworkError('conflict','Source changed before continuation');});
 return {decision:'block',reason};
}
