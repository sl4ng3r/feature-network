import { afterEach, expect, test } from 'vitest';
import { projectV2 } from '../helpers/connected.js';
import { cleanup } from '../project/helpers.js';
const api = await import('../../src/storage/documents.js').catch(() => null);
const diagnostics = await import('../../src/diagnostics/work.js').catch(() => null);
const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
test('warm_metadata_read_reuses_parsed_yaml_without_source_or_knowledge_writes', async () => {
  expect(api?.readProjectSnapshot).toBeTypeOf('function'); expect(diagnostics?.createWorkMeter).toBeTypeOf('function');
  const f = await projectV2(roots,'A'); const first = diagnostics!.createWorkMeter();
  await api!.readProjectSnapshot(f.project,{sourceMode:'none',meter:first}); expect(first.yamlParses).toBe(2);
  const second = diagnostics!.createWorkMeter(); const snapshot = await api!.readProjectSnapshot(f.project,{sourceMode:'none',meter:second});
  expect(snapshot.validation.sources).toBe('none'); expect(second.yamlParses).toBe(0); expect(second.sourceReadOps).toBe(0); expect(second.knowledgeWrites).toBe(0);
  expect(second.metadataChecks).toBeGreaterThan(0);
});
test('full_validation_hashes_one_shared_source_once_per_fresh_validation_pass',async()=>{const f=await projectV2(roots,'Shared evidence');const {writeFile}=await import('node:fs/promises');const {join}=await import('node:path');const {testFeature}=await import('../helpers/connected.js');const doc=testFeature();doc.evidence=[{path:'src/source.ts'}];doc.relations=[{to:'access',type:'reads',status:'evidenced',evidence:[{path:'src/source.ts'}],knowledge:[]}];await writeFile(join(f.root,'network-spec/access.yaml'),JSON.stringify(doc));const meter=diagnostics!.createWorkMeter();const snap=await api!.readProjectSnapshot(f.project,{sourceMode:'all',meter});expect(snap.integrity).toBe('valid');expect(meter.sourceReadOps).toBe(1);expect(meter.sourceBytes).toBe(Buffer.byteLength('export const access = true;\n'));});
