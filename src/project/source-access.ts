import { assertConnection,type ConnectionBinding } from './connections.js';
import type { StorageOptions } from '../storage/repository.js';
import { readLocalSource,type SourceReader } from '../storage/documents.js';
import { assertMissingReference } from '../storage/sources.js';
import { isMissing } from '../storage/lock.js';
import { withWorkMeter,type WorkMeter } from '../diagnostics/work.js';
export function createSourceReader(binding:ConnectionBinding,options:StorageOptions & {meter?:WorkMeter}):SourceReader{
 return async ref=>withWorkMeter(options.meter,async()=>{
  const project=await assertConnection(binding,ref.project,'read_source');
  try{return {project:ref.project,path:ref.path,hash:await readLocalSource(project,ref.path,options)};}
  catch(error){if(!isMissing(error))throw error;await assertMissingReference(project,ref.path,options);return {project:ref.project,path:ref.path,state:'missing'};}
 });
}
