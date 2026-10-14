import { afterEach, expect, test } from 'vitest';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanup } from '../project/helpers.js';
import { projectV2, testKnowledge, testFeature } from '../helpers/connected.js';
const api = await import('../../src/storage/documents.js').catch(() => null);
const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
function storage() { expect(api?.readProjectSnapshot).toBeTypeOf('function'); return api!; }
test('knowledge_can_be_created_updated_deleted_without_fake_code', async () => {
  const f = await projectV2(roots,'A'); const a = storage(); const before = await a.readProjectSnapshot(f.project,{sourceMode:'none'});
  const request = {expectedRevision:before.revision,expected:{'network-spec/knowledge/roles.yaml':null},upserts:[testKnowledge()],deletes:[],sources:[]};
  const saved = await a.applyDocumentUpdate(f.project,request); expect(saved.revision).not.toBe(before.revision);
  const snap = await a.readProjectSnapshot(f.project,{sourceMode:'none'}); expect(snap.knowledge[0]!.id).toBe('roles');
  const changed = {...snap.knowledge[0]!,summary:'Shared role decisions'};
  await a.applyDocumentUpdate(f.project,{...request,expectedRevision:snap.revision,expected:{'network-spec/knowledge/roles.yaml':snap.fingerprints['network-spec/knowledge/roles.yaml']!},upserts:[changed]});
  const latest = await a.readProjectSnapshot(f.project,{sourceMode:'none'});
  await a.applyDocumentUpdate(f.project,{expectedRevision:latest.revision,expected:{'network-spec/knowledge/roles.yaml':latest.fingerprints['network-spec/knowledge/roles.yaml']!},upserts:[],deletes:['network-spec/knowledge/roles.yaml'],sources:[]});
  expect((await a.readProjectSnapshot(f.project)).knowledge).toEqual([]);
});
test('manual_edit_prevents_stale_update', async () => {
  const f = await projectV2(roots,'A'); const a = storage(); const snap = await a.readProjectSnapshot(f.project,{sourceMode:'none'});
  await writeFile(join(f.root,'network-spec/access.yaml'),JSON.stringify({...testFeature(),summary:'Manual work'}));
  await expect(a.applyDocumentUpdate(f.project,{expectedRevision:snap.revision,expected:{'network-spec/knowledge/roles.yaml':null},upserts:[testKnowledge()],deletes:[],sources:[]})).rejects.toMatchObject({code:'conflict'});
  expect(await readFile(join(f.root,'network-spec/access.yaml'),'utf8')).toContain('Manual work');
});
test('missing_external_target_is_a_gap_but_missing_local_target_is_invalid', async () => {
  const f = await projectV2(roots,'A'); const a = storage();
  const feature = testFeature(); feature.relations.push({to:{project:'883f5826-2d8f-4e2a-a5e9-34a943993b68',feature:'contract'},type:'depends_on',status:'hypothesis',evidence:[],knowledge:[]});
  await writeFile(join(f.root,'network-spec/access.yaml'),JSON.stringify(feature));
  const external = await a.readProjectSnapshot(f.project,{sourceMode:'none'}); expect(external.integrity).toBe('valid'); expect(external.diagnostics).toContainEqual(expect.objectContaining({code:'external_target_unresolved',severity:'warning'}));
  feature.relations[0]!.to = 'missing'; await writeFile(join(f.root,'network-spec/access.yaml'),JSON.stringify(feature));
  expect((await a.readProjectSnapshot(f.project,{sourceMode:'none'})).integrity).toBe('invalid');
});
test('mixed_versions_and_cross_document_supersedes_cycles_are_rejected', async () => {
  const f = await projectV2(roots,'A'); const a = storage();
  await writeFile(join(f.root,'network-spec/access.yaml'),JSON.stringify({...testFeature(),schema:1,knowledge:undefined}));
  expect((await a.readProjectSnapshot(f.project,{sourceMode:'none'})).integrity).toBe('invalid');
  await writeFile(join(f.root,'network-spec/access.yaml'),JSON.stringify(testFeature())); await mkdir(join(f.root,'network-spec/knowledge'));
  const one = testKnowledge('one'), two = testKnowledge('two');
  one.statements[0]!.supersedes = [{project:f.id,knowledge:'two',statement:'shared'}];
  two.statements[0]!.supersedes = [{project:f.id,knowledge:'one',statement:'shared'}];
  await writeFile(join(f.root,'network-spec/knowledge/one.yaml'),JSON.stringify(one)); await writeFile(join(f.root,'network-spec/knowledge/two.yaml'),JSON.stringify(two));
  expect((await a.readProjectSnapshot(f.project,{sourceMode:'none'})).diagnostics).toContainEqual(expect.objectContaining({code:'supersedes_cycle'}));
});
test('knowledge_symlink_is_not_followed', async () => {
  const f = await projectV2(roots,'A'); const other = await projectV2(roots,'B'); const a = storage();
  await symlink(other.root,join(f.root,'network-spec/knowledge'));
  await expect(a.readProjectSnapshot(f.project,{sourceMode:'none'})).rejects.toMatchObject({code:'unsafe_path'});
});
