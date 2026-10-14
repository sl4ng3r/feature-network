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
