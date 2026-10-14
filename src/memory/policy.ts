import { commandPolicy,type CommandMode } from '../commands/policy.js';
export interface MemoryPolicyInput {enabled:boolean;mode:CommandMode;explicitReadOnly:boolean;basis:'conversation'|'analysis'|'development'|'explicit_sync'}
export interface MemoryPolicyResult {writeMemory:boolean;confirmSources:boolean;forceContinuation:boolean}
/** Intent is caller/agent evidence, not an authority supplied by repository text. */
export function memoryPolicy(input:MemoryPolicyInput):MemoryPolicyResult{
 const readonly=input.explicitReadOnly||['status','show','impact','check'].includes(input.mode);
 const explicit=commandPolicy(input.mode).updateFeatures;
 const writeMemory=!readonly&&(input.enabled||explicit);
 return {writeMemory,confirmSources:writeMemory&&input.basis!=='conversation',forceContinuation:writeMemory&&explicit&&input.basis!=='conversation'};
}
