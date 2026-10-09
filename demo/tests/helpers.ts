import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tree, repo, exec } from '../../tests/project/helpers.js';
import { openProject } from '../../src/project/root.js';
import { readSnapshot } from '../../src/storage/repository.js';
import { buildIndex } from '../../src/query/index.js';
import { queryImpact } from '../../src/query/impact.js';
import type { Snapshot } from '../../src/storage/repository.js';
export async function demoProject(roots: string[], scenario: 'current' | 'empty-network' | 'pre-locale' = 'current') {
  const root = await tree(); roots.push(root);
  const base = scenario === 'current' ? 'demo' : `demo/scenarios/${scenario}`;
  await cp(`${base}/src`, join(root, 'src'), { recursive: true });
  if (scenario !== 'empty-network') await cp(`${base}/network-spec`, join(root, 'network-spec'), { recursive: true });
  await repo(root); await exec('git', ['-C', root, 'add', '.']); return openProject(root);
}
export const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export async function sourceHashes(root: string, snapshot: Snapshot) {
  const paths = [...new Set(snapshot.features.flatMap(f => [...f.code, ...f.evidence, ...f.relations.flatMap(r => r.evidence)].map(r => r.path)))];
  return Promise.all(paths.map(async path => ({ path, hash: digest(await readFile(join(root, path))) })));
}
// Synthetic external Soll oracle. No parser, model or host infers field semantics here.
export function coverageGaps(snapshot: Snapshot, expectedFields: string[], expectedCheck: string) {
  const gaps: string[] = []; const byId = new Map(snapshot.features.map(f => [f.id, f]));
  for (const id of ['user-profile', 'backup', 'restore']) {
    if (!byId.get(id)?.key_points.includes(`Persistent fields: ${expectedFields.join(', ')}.`)) gaps.push(`${id}: fields`);
  }
  for (const [from, to, type] of [['backup', 'user-profile', 'reads'], ['restore', 'backup', 'reads'], ['restore', 'user-profile', 'writes']]) {
    if (!byId.get(from!)?.relations.some(r => r.to === to && r.type === type && r.status === 'evidenced' && r.evidence.length > 0 && r.check === expectedCheck)) gaps.push(`${from}->${to}: relation`);
  }
  const reached = queryImpact(buildIndex(snapshot), { ids: ['user-profile'] }).items.map(i => i.id);
  for (const id of ['backup', 'restore']) if (!reached.includes(id)) gaps.push(`${id}: unreachable`);
  return gaps;
}
export { readSnapshot };
