import {mkdtemp,mkdir,readFile,writeFile,unlink,rm} from 'node:fs/promises';
import {tmpdir,platform,arch,cpus,totalmem} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import {openProject,type Project} from '../src/project/root.js';
import {applyConnections,planConnections,readConnections} from '../src/project/connections.js';
import {readConnectedContext,readConnectedImpact,invalidateConnectedCache} from '../src/query/connected.js';
import {readConnectedFreshness} from '../src/freshness/connected.js';
import {prepareMemoryDelta} from '../src/memory/delta.js';
import {applyMemoryDelta} from '../src/memory/maintenance.js';
import {readProjectSnapshot} from '../src/storage/documents.js';
import {createWorkMeter,withWorkMeter,type WorkMeter} from '../src/diagnostics/work.js';
import {digest} from '../src/storage/journal.js';
import type {FeatureV2,KnowledgeDocument} from '../src/model/v2.js';
const execute=promisify(execFile);
const integer=z.number().int().nonnegative();
const work=z.strictObject(Object.fromEntries(Object.keys(createWorkMeter()).map(key=>[key,integer])) as Record<keyof WorkMeter,typeof integer>);
const sampleSchema=z.strictObject({wallMs:z.number().finite().nonnegative(),work,outputBytes:integer.min(1),memoryBefore:z.strictObject({rss:integer,heapUsed:integer}),memoryAfter:z.strictObject({rss:integer,heapUsed:integer})});
export interface ConnectedSample {wallMs:number;work:WorkMeter;outputBytes:number;memoryBefore:{rss:number;heapUsed:number};memoryAfter:{rss:number;heapUsed:number}}
export function summarizeConnectedSamples(samples:ConnectedSample[]){
 if(!samples.length||samples.some(s=>!sampleSchema.safeParse(s).success))throw new Error('invalid_samples');
 const sorted=samples.map(s=>s.wallMs).sort((a,b)=>a-b),at=(q:number)=>sorted[Math.ceil(sorted.length*q)-1]!;
 return {samples,medianMs:at(.5),p95Ms:at(.95),minMs:sorted[0]!,maxMs:sorted.at(-1)!};
}
const phaseNames=['coldLoad','warmHint','freshImpact','oneDocumentEdit','oneSourceEdit','groupedMaintenance'] as const;
type Phase=typeof phaseNames[number];
export type ConnectedBenchmarkReport=Awaited<ReturnType<typeof measureCase>>;
export interface ConnectedBenchmarkOptions {projects:1|4|16;featuresPerProject:100|1000;degree:2|12;samples:number}
const featureId=(i:number)=>`feature-${String(i).padStart(4,'0')}`;
const memory=()=>{const {rss,heapUsed}=process.memoryUsage();return {rss,heapUsed};};
async function boundedWrites(items:{path:string;text:string}[]):Promise<void>{for(let i=0;i<items.length;i+=32)await Promise.all(items.slice(i,i+32).map(f=>writeFile(f.path,f.text)));}
async function fixture(root:string,options:ConnectedBenchmarkOptions):Promise<{project:Project;id:string}[]>{
 const projects:{project:Project;id:string}[]=[];
 for(let p=0;p<options.projects;p++){
  const directory=join(root,`project-${p}`);await mkdir(directory);await execute('git',['init','--quiet','--template=','-b','main',directory]);await mkdir(join(directory,'network-spec'));await mkdir(join(directory,'src'));
  const id=randomUUID(),project=await openProject(directory);projects.push({project,id});await writeFile(project.markerPath,JSON.stringify({schema:2,coverage:'partial',project:{id,name:`Synthetic ${p}`}}));
 }
 for(let p=0;p<projects.length;p++){
  const {project}=projects[p]!,files:{path:string;text:string}[]=[];
  for(let i=0;i<options.featuresPerProject;i++){
   const path=`src/${featureId(i)}.ts`,previous=projects[p-1];
   const document:FeatureV2={schema:2,id:featureId(i),summary:`Synthetic feature ${p} ${i}`,key_points:['Synthetic manual point.'],code:[{path}],evidence:[],hypotheses:[],knowledge:[],relations:Array.from({length:options.degree},(_,edge)=>({to:i===0&&edge===0&&previous?{project:previous.id,feature:featureId(0)}:featureId((i+edge+1)%options.featuresPerProject),type:'depends_on',status:'evidenced',evidence:[{path}],knowledge:[]}))};
   files.push({path:join(project.root,path),text:`export const value = ${i};\n`},{path:join(project.networkDir,featureId(i)+'.yaml'),text:JSON.stringify(document)});
  }
  await boundedWrites(files);
 }
 const active=projects[0]!.project;await applyConnections(await planConnections(active,{schema:1,learning:{enabled:true},projects:projects.slice(1).map(p=>({id:p.id,root:p.project.root,readSources:true,writeMemory:true}))}));return projects;
}
async function measureCase(options:ConnectedBenchmarkOptions){
 const root=await mkdtemp(join(tmpdir(),'fn-connected-bench-'));
 try{
  const projects=await fixture(root,options),active=projects[0]!,phases=Object.fromEntries(phaseNames.map(p=>[p,[] as ConnectedSample[]])) as Record<Phase,ConnectedSample[]>;
  const networkFile=join(active.project.networkDir,featureId(0)+'.yaml'),sourceFile=join(active.project.root,'src',featureId(0)+'.ts');const originalDocument=await readFile(networkFile,'utf8'),originalSource=await readFile(sourceFile,'utf8');
  let groupReview='open',noOpKnowledgeWrites=0,noOpRuntimeWrites=0;
  for(let sample=0;sample<options.samples;sample++){
   // Distinct documented option bindings make parsing/index caches cold. No
   // source matches these nonexistent exclusion roots. OS page cache is uncontrolled.
   const storage={excludedReferenceRoots:[join(root,`cache-scope-${sample}`)]};
   const measure=async<T>(phase:Phase,action:(meter:WorkMeter)=>Promise<T>):Promise<T>=>{const meter=createWorkMeter(),before=memory(),start=performance.now();const result=await withWorkMeter(meter,()=>action(meter));const encoded=Buffer.from(JSON.stringify(result));const wallMs=performance.now()-start;phases[phase].push({wallMs,work:{...meter},outputBytes:encoded.length,memoryBefore:before,memoryAfter:memory()});return result;};
   let binding=await readConnections(active.project);
   const context={scope:'connected' as const,query:'Synthetic',limit:20,maxProjects:options.projects,maxVisitedFeatures:1000,budget:64000};
   await measure('coldLoad',async meter=>{binding=await readConnections(active.project);return readConnectedContext(binding,context,{...storage,meter});});
   await measure('warmHint',meter=>readConnectedContext(binding,context,{...storage,meter}));
   const impact={features:[{project:active.id,feature:featureId(0)}],direction:'incoming' as const,depth:2,maxProjects:options.projects,maxVisitedFeatures:1000,budget:64000};
   const queryOptions=(meter:WorkMeter)=>({...storage,meter,readFreshness:(refs:Parameters<typeof readConnectedFreshness>[1])=>readConnectedFreshness(binding,refs,{...storage,meter})});
   await measure('freshImpact',meter=>readConnectedImpact(binding,impact,queryOptions(meter)));
   await writeFile(networkFile,JSON.stringify({...JSON.parse(originalDocument),summary:'Edited synthetic feature'}));
   await measure('oneDocumentEdit',meter=>readConnectedContext(binding,{...context,ids:[featureId(0)],query:'',freshness:'returned_features'},queryOptions(meter)));
   await writeFile(sourceFile,originalSource+'// source-only edit\n');
   await measure('oneSourceEdit',meter=>readConnectedImpact(binding,impact,queryOptions(meter)));
   const notes:KnowledgeDocument={schema:2,kind:'knowledge',id:'bench-notes',summary:'Grouped synthetic discussion',features:[],statements:[{id:'idea',type:'idea',state:'active',text:'Consider shared policy.',origin:{kind:'user_statement',recorded_on:'2026-10-15',context:'Synthetic discussion'},evidence:[],contradicts:[],supersedes:[]},{id:'requirement',type:'requirement',state:'active',text:'Preserve explicit denial.',origin:{kind:'user_statement',recorded_on:'2026-10-15',context:'Synthetic user requirement'},evidence:[],contradicts:[],supersedes:[]}]};
   const before=await readProjectSnapshot(active.project,{...storage,sourceMode:'none'}),delta=prepareMemoryDelta(before,[notes],[],'Two related discussion findings');
   const receipt=await measure('groupedMaintenance',meter=>applyMemoryDelta(binding,active.id,delta,{mode:'unspecified',explicitReadOnly:false,basis:'conversation'},{...storage,meter}));groupReview=receipt!.review;
   const after=await readProjectSnapshot(active.project,{...storage,sourceMode:'none'}),noop=prepareMemoryDelta(after,[notes],[],'Same discussion');const noopMeter=createWorkMeter();await applyMemoryDelta(binding,active.id,noop,{mode:'unspecified',explicitReadOnly:false,basis:'conversation'},{...storage,meter:noopMeter});noOpKnowledgeWrites+=noopMeter.knowledgeWrites;noOpRuntimeWrites+=noopMeter.runtimeWrites;
   await unlink(join(active.project.networkDir,'knowledge/bench-notes.yaml'));await writeFile(networkFile,originalDocument);await writeFile(sourceFile,originalSource);invalidateConnectedCache(active.project.root);
  }
  const summarized=Object.fromEntries(phaseNames.map(p=>[p,summarizeConnectedSamples(phases[p])])) as Record<Phase,ReturnType<typeof summarizeConnectedSamples>>;
  return {format:1,kind:'synthetic-connected-filesystem' as const,measuredAt:new Date().toISOString(),fixture:{...options,features:options.projects*options.featuresPerProject,edges:options.projects*options.featuresPerProject*options.degree,topology:'local cyclic ring; first consumer edge links the prior project'},machine:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model??'unavailable',logicalCpus:cpus().length,totalMemoryBytes:totalmem(),node:process.version},execution:{moduleSha256:digest(await readFile(fileURLToPath(import.meta.url)))},effective:{maxProjects:options.projects,maxVisitedFeatures:1000,limit:20,budget:64000,depth:2,direction:'incoming'},cache:{cold:'fresh option-bound document/index caches in an existing process; synthetic registry setup excluded',warm:'same bound caches',osPageCache:'uncontrolled'},scope:{documentReadCoverage:'network_yaml_only' as const,included:['actual network filesystem/cache identity reads','shared YAML parsing','source hashing by returned-feature checks and full write validation','indexing/traversal','journal/runtime/file publication','core JSON serialization'],excluded:['fixture creation and external manual edits/restoration','process startup and MCP transport/wrapper','hooks','agent/model analysis','all OS syscall accounting'],counterDefinition:'metadataChecks counts instrumented safe-open and identity checks, not every OS stat in path confinement; documentReadOps/documentBytes cover only network-spec YAML; auxiliary register/runtime/journal byte reads are not counted; hashes counts shared digest calls; knowledgeWrites counts authoritative network file publications/deletions; networkTransactions counts completed journal publications',memory:'whole-process before/after observations; no peak or isolated allocation claim'},phases:summarized,semanticAssertions:{groupReview,noOpKnowledgeWrites,noOpRuntimeWrites},costs:{auxiliaryDocumentReadBytes:null,agentTokens:null,sourceAnalysisMs:null,agentLatencyMs:null,reason:'Auxiliary document bytes are unmeasured, not zero. No model or agent analysis was run; technical source reads include mandatory end-state validation and are not analytical review.'},limitations:['Local synthetic filesystem measurement only; no native host or agent success claim.','Five-sample p95 is a local observation, not a stable tail-latency estimate.','No token saving or cross-host speedup can be inferred.']};
 }finally{await rm(root,{recursive:true,force:true});}
}
export async function runConnectedBenchmark(options:ConnectedBenchmarkOptions):Promise<ConnectedBenchmarkReport>{
 if(!Number.isInteger(options.samples)||options.samples<1)throw new Error('invalid_samples');
 if(![1,4,16].includes(options.projects)||![100,1000].includes(options.featuresPerProject)||![2,12].includes(options.degree))throw new Error('unsupported_matrix');
 return measureCase(options);
}
