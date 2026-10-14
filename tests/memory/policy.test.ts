import {expect,test} from 'vitest';
const api=await import('../../src/memory/policy.js').catch(()=>null);
test.each([
 {enabled:true,mode:'unspecified',explicitReadOnly:false,basis:'conversation',write:true,confirm:false},
 {enabled:true,mode:'unspecified',explicitReadOnly:false,basis:'analysis',write:true,confirm:true},
 {enabled:false,mode:'unspecified',explicitReadOnly:false,basis:'analysis',write:false,confirm:false},
 {enabled:true,mode:'check',explicitReadOnly:false,basis:'analysis',write:false,confirm:false},
 {enabled:true,mode:'show',explicitReadOnly:false,basis:'conversation',write:false,confirm:false},
 {enabled:true,mode:'status',explicitReadOnly:false,basis:'development',write:false,confirm:false},
 {enabled:true,mode:'impact',explicitReadOnly:false,basis:'analysis',write:false,confirm:false},
 {enabled:true,mode:'sync',explicitReadOnly:true,basis:'explicit_sync',write:false,confirm:false},
 {enabled:false,mode:'sync',explicitReadOnly:false,basis:'explicit_sync',write:true,confirm:true},
 {enabled:false,mode:'unspecified',explicitReadOnly:false,basis:'explicit_sync',write:false,confirm:false},
] as const)('memory_policy_$mode_$basis_enabled_$enabled_readonly_$explicitReadOnly',({write,confirm,...input})=>{
 expect(api?.memoryPolicy).toBeTypeOf('function');const result=api!.memoryPolicy(input);expect(result.writeMemory).toBe(write);expect(result.confirmSources).toBe(confirm);if(input.basis==='conversation'||input.mode==='unspecified')expect(result.forceContinuation).toBe(false);
});
