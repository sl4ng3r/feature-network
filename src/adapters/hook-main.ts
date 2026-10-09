import { basename, dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleCodexEvent } from './codex.js';
import { handleCopilotEvent, type CopilotEvent } from './copilot.js';
/** A hook is a bounded fail-open process: stderr contains only fixed diagnostics. */
export async function runHook(argv: string[], installedRoot: string): Promise<number> {
  let sent = false;
  const send = (output: unknown) => { if (!sent) { sent = true; process.stdout.write(JSON.stringify(output) + '\n'); } };
  const timeout = setTimeout(() => {
    process.stderr.write('FeatureNetwork: hook_timeout; automatic maintenance skipped.\n'); send({}); process.exit(0);
  }, 6000);
  try {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error();
    const host = argv[0] === '--host' ? argv[1] : undefined;
    if (!(host === 'codex' && argv.length === 2 || host === 'copilot' && argv.length === 4 && argv[2] === '--event' && ['sessionStart', 'userPromptSubmitted', 'agentStop'].includes(argv[3]!))) throw new Error();
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of process.stdin) {
      const data = Buffer.from(chunk); bytes += data.byteLength;
      if (bytes > 262144) throw new Error(); chunks.push(data);
    }
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    const result = host === 'codex' ? await handleCodexEvent(payload, { pluginRoot: installedRoot })
      : await handleCopilotEvent(payload, { pluginRoot: installedRoot, event: argv[3] as CopilotEvent });
    send(result);
  } catch { process.stderr.write('FeatureNetwork: hook_input_or_runtime_unavailable; automatic maintenance skipped.\n'); send({}); }
  finally { clearTimeout(timeout); }
  return 0;
}
if (process.argv[1] && basename(fileURLToPath(import.meta.url)) === 'hook.mjs' && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await runHook(process.argv.slice(2), dirname(dirname(fileURLToPath(import.meta.url))));
}
