/** Explicit command capabilities; unspecified alone never authorizes maintenance.
 * Hosts need separate evidence of development and changes in the current turn.
 */
export type CommandMode = 'init' | 'status' | 'show' | 'impact' | 'check' | 'sync' | 'unspecified';
export interface CommandPolicy { analyzeCode: boolean; updateFeatures: boolean; continueForMaintenance: boolean }

export function classifyCommand(text: string): CommandMode {
  const match = /^\s*[/$]feature-network-(init|status|show|impact|check|sync)(?=\s|$)/.exec(text);
  return (match?.[1] as CommandMode | undefined) ?? 'unspecified';
}

export function commandPolicy(mode: CommandMode): CommandPolicy {
  const enabled = mode === 'init' || mode === 'sync';
  return { analyzeCode: enabled, updateFeatures: enabled, continueForMaintenance: enabled };
}
