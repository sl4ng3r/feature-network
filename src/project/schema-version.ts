import type {Project} from './root.js';
import {readStorage,digest} from '../storage/journal.js';
import {parseNetworkMeta} from '../model/documents.js';
const versions=new Map<string,{hash:string;version:1|2}>();
/** Inspect actual bound marker bytes; only unchanged parsing is cached. */
export async function projectSchema(project:Project):Promise<1|2|null>{
 const raw=await readStorage(project,'network-spec/_meta.yaml');if(raw===null)return null;
 const hash=digest(raw),cached=versions.get(project.root);if(cached?.hash===hash)return cached.version;
 const version=parseNetworkMeta(raw).schema;
 if(versions.size>=128)versions.delete(versions.keys().next().value!);versions.set(project.root,{hash,version});return version;
}
