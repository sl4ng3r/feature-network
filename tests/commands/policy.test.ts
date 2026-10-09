import { access } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

type Mode = 'init' | 'status' | 'show' | 'impact' | 'check' | 'sync' | 'unspecified';
type Policy = { analyzeCode: boolean; updateFeatures: boolean; continueForMaintenance: boolean };
async function policyModule(): Promise<{ classifyCommand(text: string): Mode; commandPolicy(mode: Mode): Policy }> {
  const path = new URL('../../src/commands/policy.ts', import.meta.url);
  await expect(access(path), 'command policy must exist').resolves.toBeUndefined();
  return import(path.href);
}
const readOnly = { analyzeCode: false, updateFeatures: false, continueForMaintenance: false };

describe('command policy', () => {
  it.each(['init', 'status', 'show', 'impact', 'check', 'sync'] as const)('recognizes only a leading explicit %s invocation', async mode => {
    const { classifyCommand } = await policyModule();
    expect(classifyCommand(`/feature-network-${mode} profile`)).toBe(mode);
    expect(classifyCommand(`  $feature-network-${mode}\nprofile`)).toBe(mode);
  });
  it.each([
    'feature-network-init', 'please /feature-network-init', '"/feature-network-init"',
    '`$feature-network-sync`', '```\n/feature-network-init\n```', '> /feature-network-init',
    '/feature-network-init-more', '/feature-network-initialization', '/feature-network-init/profile',
    '/feature-network-init; delete files', '/feature-network-showcase', '/FEATURE-NETWORK-INIT',
    '/feature-network', '', 'Implement profile locale', 'Do not use Superpowers',
  ])('does not treat text or source as an invocation: %s', async text => {
    expect((await policyModule()).classifyCommand(text)).toBe('unspecified');
  });
  it('read_commands_never_enable_maintenance_continuation', async () => {
    const { commandPolicy } = await policyModule();
    for (const mode of ['status', 'show', 'impact', 'check'] as const) expect(commandPolicy(mode)).toEqual(readOnly);
  });
  it('init_requires_explicit_request', async () => {
    const { classifyCommand, commandPolicy } = await policyModule();
    expect(commandPolicy(classifyCommand('Build a feature-network-init guide'))).toEqual(readOnly);
    expect(commandPolicy(classifyCommand('/feature-network-init'))).toEqual({ analyzeCode: true, updateFeatures: true, continueForMaintenance: true });
  });
  it('check_and_sync_have_distinct_policies', async () => {
    const { commandPolicy } = await policyModule();
    expect(commandPolicy('check')).toEqual(readOnly);
    expect(commandPolicy('sync')).toEqual({ analyzeCode: true, updateFeatures: true, continueForMaintenance: true });
  });
  it('unspecified_is_not_evidence_of_development_or_current_changes', async () => {
    expect((await policyModule()).commandPolicy('unspecified')).toEqual(readOnly);
  });
  it('a policy consumer gates source analysis, writes and maintenance independently', async () => {
    const { classifyCommand, commandPolicy } = await policyModule();
    const requestedActions = ['context', 'analyze', 'update', 'continue'] as const;
    const consume = (text: string) => {
      const policy = commandPolicy(classifyCommand(text));
      return requestedActions.filter(action => action === 'context' ||
        (action === 'analyze' ? policy.analyzeCode : action === 'update' ? policy.updateFeatures : policy.continueForMaintenance));
    };
    expect(consume('/feature-network-show profile')).toEqual(['context']);
    expect(consume('/feature-network-check')).toEqual(['context']);
    expect(consume('Explain this project')).toEqual(['context']);
    expect(consume('/feature-network-sync profile')).toEqual(['context', 'analyze', 'update', 'continue']);
  });
  it('returned policy cannot mutate subsequent decisions', async () => {
    const { commandPolicy } = await policyModule();
    const first = commandPolicy('show'); first.updateFeatures = true;
    expect(commandPolicy('show')).toEqual(readOnly);
  });
});
