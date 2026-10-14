import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openProject} from '../../src/project/root.js';
import {readConnections,assertConnection} from '../../src/project/connections.js';
import {hasJournal} from '../../src/storage/journal.js';
import {applyMemoryDelta,readMaintenance} from '../../src/memory/maintenance.js';
const [root,id,deltaJson,contextJson,phase]=process.argv.slice(2);
const active=await openProject(root!);const binding=await readConnections(active);const target=await assertConnection(binding,id!,'write_memory');const delta=JSON.parse(deltaJson!),context=JSON.parse(contextJson!);
await applyMemoryDelta(binding,id!,delta,context,{beforePublish:async()=>{
 const progress=await readMaintenance(active,context.operationId);
 const entry=progress?.targets[id!];const journal=await hasJournal(target);
 const path=phase==='before_review'?'network-spec/access.yaml':'network-spec/knowledge/roles.yaml';const content=await readFile(join(target.root,path),'utf8').catch(()=>null);
 if(phase==='during_journal'&&journal||phase==='after_target'&&!journal&&content!==null&&entry?.phase==='prepared'||phase==='before_review'&&entry?.phase==='applied'){
  process.send?.('phase-ready');await new Promise(()=>{});
 }
}});
