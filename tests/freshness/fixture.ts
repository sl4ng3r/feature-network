import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Feature } from '../../src/model/types.js';
import { openProject } from '../../src/project/root.js';
import { applyUpdate } from '../../src/storage/repository.js';
import { repo, tree, exec } from '../project/helpers.js';
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export async function fixture(roots: string[], git = true) {
  const root = await tree(); roots.push(root); if (git) await repo(root);
  await writeFile(join(root, 'source.ts'), 'source');
  const project = await openProject(root);
  const feature: Feature = { schema: 1, id: 'alpha', summary: 'Source', key_points: [], code: [{ path: 'source.ts' }], evidence: [], relations: [], hypotheses: [] };
  await applyUpdate(project, { expected: { 'network-spec/_meta.yaml': null, 'network-spec/alpha.yaml': null }, upserts: [feature], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }], initialize: true });
  if (git) await commit(root);
  return project;
}
export async function commit(root: string) { await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-qm', 'fixture']); }
