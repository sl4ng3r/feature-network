import {build} from 'esbuild';
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if(!/^v24\./.test(process.version))throw new Error('node_24_required');
const temporary=await mkdtemp(resolve('.feature-network-build-connected-'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
try{
 const outfile=resolve(temporary,'connected.mjs');
 const built=await build({entryPoints:['bench/connected.ts'],outfile,bundle:true,platform:'node',format:'esm',target:'node24',metafile:true,logLevel:'silent',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
 const {runConnectedBenchmark}=await import(pathToFileURL(outfile).href),cases=[];
 for(const projects of [1,4,16])for(const featuresPerProject of [100,1000])for(const degree of [2,12]){
  cases.push(await runConnectedBenchmark({projects,featuresPerProject,degree,samples:5}));
  process.stderr.write(`Connected filesystem benchmark: ${cases.length}/12 cases completed.\n`);
 }
 let sourceRevision=null,sourceTree=null,workingTreeDirty=null;
 try{if(await realpath(git('rev-parse','--show-toplevel'))===await realpath(process.cwd())){sourceRevision=git('rev-parse','HEAD');sourceTree=git('rev-parse','HEAD^{tree}');workingTreeDirty=git('status','--porcelain').length>0;}}catch{}
 const inputs=await Promise.all([...Object.keys(built.metafile.inputs),'scripts/bench-connected.mjs'].sort().map(async path=>({path,sha256:sha256(await readFile(path))})));
 const report={format:1,kind:'synthetic-connected-filesystem-matrix',measuredAt:new Date().toISOString(),matrix:{projects:[1,4,16],featuresPerProject:[100,1000],degree:[2,12],samplesPerPhase:5,phases:['coldLoad','warmHint','freshImpact','oneDocumentEdit','oneSourceEdit','groupedMaintenance']},provenance:{sourceRevision,sourceTree,workingTreeDirty,loadedBundleSha256:sha256(await readFile(outfile)),inputs,sourceBinding:'Exact executed bundle hash; HEAD/tree are nullable metadata; inputs are post-build source observations.'},cases};
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{await rm(temporary,{recursive:true,force:true});}
