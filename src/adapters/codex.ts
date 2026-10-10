import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { bootstrap } from '../bootstrap/state.js';
import { classifyCommand, commandPolicy } from '../commands/policy.js';
import { checkNetwork } from '../freshness/check.js';
import { readTurn, startTurn } from '../freshness/session.js';
import { NetworkError } from '../model/errors.js';
import { discoverHookProject } from '../project/root.js';
import { digest } from '../storage/journal.js';
import { readRuntime, runtimeRevision, writeRuntime } from '../storage/runtime.js';

export interface HostOutput {
  hookSpecificOutput?: { hookEventName: string; additionalContext: string };
  additionalContext?: string;
  systemMessage?: string;
  decision?: 'block';
  reason?: string;
}
/** Trusted executable context, never populated from hook stdin. */
export interface AdapterOptions { pluginRoot: string }
const id = z.string().min(1).max(128);
const receiptSchema = z.object({ version: z.literal(1), sessionId: id, hostTurnId: id, coreTurnId: z.string().uuid(),
  mode: z.enum(['init', 'sync', 'unspecified']), continued: z.boolean() });
const common = z.object({ cwd: z.string().min(1).max(8192), session_id: id, hook_event_name: z.enum(['SessionStart', 'UserPromptSubmit', 'Stop']) });
const context = (event: string, text: string): HostOutput => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
const missing = 'FeatureNetwork: no project memory marker. Offer feature-network-init only on explicit request; do not auto-initialize.';
export const hookFailure = (): HostOutput => ({ systemMessage: 'FeatureNetwork: local hook evidence unavailable; continue without automatic maintenance.' });

/** Bounded host payload; prompts are classified in memory and never persisted. */
export async function handleCodexEvent(payload: unknown, trusted: AdapterOptions): Promise<HostOutput> {
  const parsed = common.safeParse(payload);
  if (!parsed.success) return {};
  const event = parsed.data;
  try {
    const project = await discoverHookProject(event.cwd);
    if (!project) return event.hook_event_name === 'Stop' ? {} : context(event.hook_event_name, missing);
    const options = { excludedReferenceRoots: [await realpath(trusted.pluginRoot)], allowRecovery: false };
    if (event.hook_event_name === 'SessionStart') {
      const check = await checkNetwork(project, 'summary', undefined, options);
      return context('SessionStart', `FeatureNetwork: ${check.integrity}; ${check.openDecisions.length} open decisions (last_known). Use feature-network skill and five network MCP tools; coverage remains partial. No automatic full analysis.`);
    }
    const turnPayload = z.object({ turn_id: id }).safeParse(payload);
    if (!turnPayload.success) return {};
    const hostTurnId = turnPayload.data.turn_id;
    const key = `hooks/codex/${digest(event.session_id)}`;
    if (event.hook_event_name === 'UserPromptSubmit') {
      const prompt = z.object({ prompt: z.string().max(262144) }).safeParse(payload);
      if (!prompt.success) return {};
      const mode = classifyCommand(prompt.data.prompt);
      if (mode !== 'unspecified' && !commandPolicy(mode).continueForMaintenance) return {};
      const prior = await readRuntime(project, key);
      // A repeated delivery must not reset the captured baseline or continuation guard.
      const existing = receiptSchema.safeParse(prior);
      if (existing.success && existing.data.hostTurnId === hostTurnId) return {};
      const core = await startTurn(project, event.session_id, options);
      if (core.integrity !== 'valid') return {};
      const receipt = { version: 1, sessionId: event.session_id, hostTurnId, coreTurnId: core.turnId, mode, continued: false };
      await writeRuntime(project, key, prior === null ? null : runtimeRevision(prior), receipt, options, async () => {
        if ((await readTurn(project, event.session_id))?.turnId !== core.turnId) throw new NetworkError('conflict', 'Turn changed');
      });
      return context('UserPromptSubmit', `FeatureNetwork: turn baseline captured. Use network_check with sessionId ${JSON.stringify(event.session_id)} for current-turn scope. Continue the user's authorized coding and testing task when present; this context does not withdraw original product-work authorization. These limits concern only additional FeatureNetwork memory maintenance: after actual current-turn source changes, review scoped memory only. Read commands stay read-only; a memory-only Stop continuation must not add product edits or process old backlog.`);
    }
    if (!z.object({ stop_hook_active: z.literal(false) }).safeParse(payload).success) return {};
    const raw = await readRuntime(project, key); const receipt = receiptSchema.safeParse(raw);
    if (!receipt.success || receipt.data.continued || receipt.data.sessionId !== event.session_id || receipt.data.hostTurnId !== hostTurnId) return {};
    const turn = await readTurn(project, event.session_id);
    if (turn?.turnId !== receipt.data.coreTurnId) return {};
    const check = await checkNetwork(project, 'full', event.session_id, options);
    if (check.integrity === 'pending_recovery' || check.changeCoverage !== 'git' || check.turnAssumptions === 'not_recorded'
      || check.diagnostics.some(d => d.code === 'branch_changed')) return {};
    let reason: string;
    if (receipt.data.mode === 'init') {
      const run = await bootstrap(project, { action: 'status' }, options);
      if (!['pending', 'needs_review', 'awaiting_relational_review'].includes(run.status)) return {};
      reason = 'Continue the explicitly requested feature-network-init with one bounded bootstrap package or final relationship review. Preserve existing features. Do not modify product code or databases; report remaining partial coverage.';
    } else {
      const current = new Set(check.turnChanges);
      const open = check.openDecisions.filter(decision => current.has(decision.path));
      if (!open.length) return {};
      reason = `FeatureNetwork: ${open.length} current-turn change(s) still require memory review. Use network_check full with sessionId ${JSON.stringify(event.session_id)}; review only turnChanges that remain open, update affected features or record reasoned no_semantic_change. Do not process old backlog or edit product code. Report unresolved evidence after this single continuation.`;
    }
    await writeRuntime(project, key, runtimeRevision(raw), { ...receipt.data, continued: true }, options, async () => {
      if ((await readTurn(project, event.session_id))?.turnId !== turn.turnId) throw new NetworkError('conflict', 'Turn changed');
    });
    return { decision: 'block', reason };
  } catch { return hookFailure(); }
}
