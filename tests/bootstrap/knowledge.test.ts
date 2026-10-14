import {afterEach,expect,test} from 'vitest';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {projectV2,testKnowledge} from '../helpers/connected.js';
import {cleanup} from '../project/helpers.js';
import {bootstrap} from '../../src/bootstrap/state.js';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
test('schema_two_bootstrap_preserves_knowledge_bytes_and_only_maps_real_features',async()=>{const f=await projectV2(roots,'Bootstrap'),text='# Manual note\n'+JSON.stringify(testKnowledge())+'\n';await mkdir(join(f.root,'network-spec/knowledge'));await writeFile(join(f.root,'network-spec/knowledge/roles.yaml'),text);const started=await bootstrap(f.project,{action:'start'});expect(started.status).toBe('pending');expect(started.package!.slices.map(s=>s.path)).toEqual(['src/source.ts']);const s=started.package!.slices[0]!,snapshot=await f.snapshot();const finished=await bootstrap(f.project,{action:'checkpoint',expectedRunRevision:started.runRevision!,packageId:started.package!.id,networkRevision:snapshot.revision,sources:[{path:s.path,hash:s.fileHash}],featureFingerprints:{access:snapshot.fingerprints['network-spec/access.yaml']!},results:[{path:s.path,startByte:s.startByte,endByte:s.endByte,featureIds:['access'],outcome:'analyzed',reason:'Inspected source'}]});expect(finished.status).toBe('awaiting_relational_review');expect(await readFile(join(f.root,'network-spec/knowledge/roles.yaml'),'utf8')).toBe(text);});
