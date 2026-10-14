import { projectSchema } from '../project/schema-version.js';
import { connectedHostHint } from './connected.js';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { checkNetwork } from '../freshness/check.js';
import { discoverHookProject } from '../project/root.js';
import type { AdapterOptions, HostOutput } from './codex.js';
export type CopilotEvent = 'sessionStart' | 'userPromptSubmitted' | 'agentStop';
/** Event is supplied by the generated command, not guessed from stdin fields. */
export async function handleCopilotEvent(payload: unknown, trusted: AdapterOptions & { event: CopilotEvent }): Promise<HostOutput> {
  // Command prompt output is discarded by Copilot. No documented host turn ID
  // exists for correlating a later Stop: never invent one from timestamps.
  if (trusted.event !== 'sessionStart') return {};
  const parsed = z.object({ sessionId: z.string().min(1).max(128), cwd: z.string().min(1).max(8192) }).safeParse(payload);
  if (!parsed.success) return {};
  try {
    const project = await discoverHookProject(parsed.data.cwd);
    if (!project) return { additionalContext: 'FeatureNetwork: no memory marker; offer feature-network-init only on explicit request. Never auto-initialize.' };
    if(await projectSchema(project)===2)return {additionalContext:(await connectedHostHint(project))+' Copilot has no reliable host turn identity; no forced stop continuation.'};
    const check = await checkNetwork(project, 'summary', undefined, { excludedReferenceRoots: [await realpath(trusted.pluginRoot)] });
    return { additionalContext: `FeatureNetwork: ${check.integrity}, ${check.openDecisions.length} open decisions (last_known), partial coverage. Use the feature-network skill and five network MCP tools. CLI command prompt output is ignored; automatic stop continuation is unavailable without reliable host turn identity. Complete scoped memory maintenance in the skill workflow.` };
  } catch { return { additionalContext: 'FeatureNetwork: local context unavailable; continue without automatic maintenance.' }; }
}
