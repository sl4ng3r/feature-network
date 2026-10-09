import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nodeSource, profileSource } from './monorepo-generate.mjs';

const [appRaw, manifestRaw] = process.argv.slice(2);
if (!appRaw || !manifestRaw) {
  console.error('usage: node monorepo-known-good.mjs <app-directory> <external-manifest.json>');
  process.exit(2);
}
const app = resolve(appRaw);
const manifest = JSON.parse(await readFile(resolve(manifestRaw), 'utf8'));
const hash = createHash('sha256').update(JSON.stringify({ flows: manifest.flows, distractors: manifest.distractors })).digest('hex');
if (manifest.format !== 1 || manifest.workload !== 'monorepo' || manifest.manifestHash !== hash) throw new Error('invalid_manifest');
await writeFile(join(app, 'src/profile.mjs'), profileSource(true));
for (const flow of manifest.flows) for (const [kind, id] of Object.entries(flow.nodes)) {
  await writeFile(join(app, 'packages', manifest.packages[kind], `${id}.mjs`), nodeSource(flow, kind, true));
}
