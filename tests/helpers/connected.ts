import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tree, repo } from '../project/helpers.js';
import { openProject } from '../../src/project/root.js';
import type { Project } from '../../src/project/root.js';
import type { FeatureV2, KnowledgeDocument } from '../../src/model/v2.js';
export interface ProjectFixture { project: Project; id: string; root: string; snapshot(): Promise<import('../../src/storage/documents.js').ProjectSnapshot> }
export function testFeature(id = 'access'): FeatureV2 {
  return {schema:2,id,summary:'Checks access',key_points:[],code:[{path:'src/source.ts'}],evidence:[],relations:[],hypotheses:[],knowledge:[]};
}
export function testKnowledge(id = 'roles'): KnowledgeDocument {
  return {schema:2,kind:'knowledge',id,summary:'Shared roles',features:[],statements:[{id:'shared',type:'idea',state:'active',text:'Consider common roles.',origin:{kind:'user_statement',recorded_on:'2026-10-14',context:'Architecture discussion'},evidence:[],contradicts:[],supersedes:[]}]};
}
export async function projectV2(roots: string[], name: string): Promise<ProjectFixture> {
  const root = await tree(); roots.push(root); await repo(root); const id = randomUUID();
  await mkdir(join(root,'src')); await writeFile(join(root,'src/source.ts'),'export const access = true;\n');
  await mkdir(join(root,'network-spec'));
  await writeFile(join(root,'network-spec/_meta.yaml'),JSON.stringify({schema:2,coverage:'partial',project:{id,name}}));
  await writeFile(join(root,'network-spec/access.yaml'),JSON.stringify(testFeature()));
  const project = await openProject(root);
  return {project,id,root,snapshot:async () => (await import('../../src/storage/documents.js')).readProjectSnapshot(project,{sourceMode:'none'})};
}
export async function connectedFixture(roots:string[],options:{projects?:number;learning?:boolean}={}){
  const projects:ProjectFixture[]=[];
  for(let i=0;i<(options.projects??3);i++)projects.push(await projectV2(roots,`Project ${i}`));
  const active=projects[0]!;
  const {planConnections,applyConnections,readConnections}=await import('../../src/project/connections.js');
  await applyConnections(await planConnections(active.project,{schema:1,learning:{enabled:options.learning??true},projects:projects.slice(1).map(p=>({id:p.id,root:p.root,readSources:true,writeMemory:true}))}));
  const binding=await readConnections(active.project);
  const {createSourceReader}=await import('../../src/project/source-access.js');
  return {active,projects,binding,sourceReader:createSourceReader(binding,{})};
}
export async function revokeConnectionOnDisk(active:ProjectFixture,id:string):Promise<void>{
  const {readFile}=await import('node:fs/promises');const {parseConnections}=await import('../../src/project/connections.js');
  const file=join(active.project.runtimeDir,'connections.yaml');const config=parseConnections(await readFile(file,'utf8'));config.projects=config.projects.filter(p=>p.id!==id);await writeFile(file,JSON.stringify(config));
}
