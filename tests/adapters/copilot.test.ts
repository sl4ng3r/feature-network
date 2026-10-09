import { expect, test } from 'vitest';
import { resolve } from 'node:path';
import { handleCopilotEvent } from '../../src/adapters/copilot.js';
test('copilot_prompt_output_not_injected', async () => {
  expect(await handleCopilotEvent({ sessionId: 'redacted', timestamp: 1, cwd: '/redacted', prompt: '/feature-network-sync' }, { pluginRoot: resolve('plugin'), event: 'userPromptSubmitted' })).toEqual({});
});
test('copilot_stop_without_host_turn_identity_does_not_invent_continuation', async () => {
  expect(await handleCopilotEvent({ sessionId: 'redacted', timestamp: 2, cwd: '/redacted', stopReason: 'end_turn', stop_hook_active: false }, { pluginRoot: resolve('plugin'), event: 'agentStop' })).toEqual({});
});
