import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bootstrap } from '../../src/bootstrap/state.js';
import { applyUpdate } from '../../src/storage/repository.js';
import { parseFeature } from '../../src/model/schema.js';
import { cleanup } from '../../tests/project/helpers.js';
import { demoProject, readSnapshot, sourceHashes } from './helpers.js';
const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
test('empty_network_initialization_is_only_a_protocol_test_with_prescribed_answers', async () => {
  const project = await demoProject(roots, 'empty-network'); const before = await readSnapshot(project); expect(before.integrity).toBe('not_initialized');
  const sourceBefore = await readFile(join(project.root, 'src/profile.ts'));
  const pending = await bootstrap(project, { action: 'start' }); expect(pending.package).not.toBeNull();
  const features = await Promise.all(['user-profile', 'backup', 'restore'].map(async id => parseFeature(await readFile(`demo/scenarios/pre-locale/network-spec/${id}.yaml`, 'utf8'), `${id}.yaml`)));
  await applyUpdate(project, { expected: { 'network-spec/_meta.yaml': null, ...Object.fromEntries(features.map(f => [`network-spec/${f.id}.yaml`, null])) }, expectedRevision: before.revision, initialize: true, upserts: features, deletes: [], verifiedReferences: await sourceHashes(project.root, { ...before, features }) });
  const saved = await readSnapshot(project); const fingerprints = Object.fromEntries(saved.features.map(f => [f.id, saved.fingerprints[`network-spec/${f.id}.yaml`]!]));
  await bootstrap(project, { action: 'checkpoint', expectedRunRevision: pending.runRevision!, packageId: pending.package!.id, networkRevision: saved.revision,
    sources: [...new Map(pending.package!.slices.map(s => [s.path, { path: s.path, hash: s.fileHash }])).values()], featureFingerprints: fingerprints,
    results: pending.package!.slices.map(s => ({ path: s.path, startByte: s.startByte, endByte: s.endByte, outcome: 'analyzed', featureIds: Object.keys(fingerprints), reason: 'Prescribed synthetic answers test protocol persistence only.' })) });
  const reconciled = await bootstrap(project, { action: 'next' }); expect(reconciled.package).toBeNull();
  const done = await bootstrap(project, { action: 'checkpoint', expectedRunRevision: reconciled.runRevision!, packageId: null, networkRevision: saved.revision, sources: [], results: [], featureFingerprints: fingerprints, relationalReviewComplete: true, reason: 'Prescribed synthetic relation oracle; no actual host agent analysis claimed.' });
  expect(done).toMatchObject({ status: 'completed', coverage: 'partial' }); expect(await readFile(join(project.root, 'src/profile.ts'))).toEqual(sourceBefore);
}, 20000);
