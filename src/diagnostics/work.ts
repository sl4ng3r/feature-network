import { AsyncLocalStorage } from 'node:async_hooks';
export interface WorkMeter {
  metadataChecks:number; documentReadOps:number; documentBytes:number; yamlParses:number;
  sourceReadOps:number; sourceBytes:number; hashes:number; visitedFeatures:number;
  indexReplacements:number; knowledgeWrites:number; runtimeWrites:number;
}
const scope = new AsyncLocalStorage<WorkMeter>();
export function createWorkMeter(): WorkMeter {
  return {metadataChecks:0,documentReadOps:0,documentBytes:0,yamlParses:0,sourceReadOps:0,sourceBytes:0,hashes:0,visitedFeatures:0,indexReplacements:0,knowledgeWrites:0,runtimeWrites:0};
}
export function countWork(key: keyof WorkMeter, count = 1): void { const meter = scope.getStore(); if (meter) meter[key] += count; }
export function withWorkMeter<T>(meter: WorkMeter | undefined, action: () => T): T { return meter ? scope.run(meter,action) : action(); }
