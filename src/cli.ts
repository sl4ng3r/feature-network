import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NetworkError } from './model/errors.js';
import { openProject } from './project/root.js';
import { createServer } from './mcp/server.js';
import { runHook } from './adapters/hook-main.js';
import { planSetup, readSetupConfig } from './adapters/setup.js';
export async function runCli(argv: string[]): Promise<number> {
  try {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new NetworkError('node_24_required', 'Node.js 24 LTS is required');
    const installedRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    if (argv[0] === 'hook') return runHook(argv.slice(1), installedRoot);
    if (argv[0] === 'setup') {
      if (argv.length !== 6 || argv[1] !== '--host' || !['codex', 'copilot'].includes(argv[2]!) || argv[3] !== '--project-root' || !argv[4]?.trim() || argv[5] !== '--dry-run') throw new NetworkError('setup_usage', 'Only reviewed dry-run setup is available');
      const host = argv[2] as 'codex' | 'copilot';
      const plan = await planSetup(host, argv[4], await readSetupConfig(host, argv[4]), { pluginRoot: installedRoot, nodePath: process.execPath });
      process.stdout.write(JSON.stringify(plan, null, 2) + '\n'); return 0;
    }
    if (argv.length !== 3 || argv[0] !== 'mcp' || argv[1] !== '--project-root' || !argv[2]?.trim()) throw new NetworkError('project_root_required', 'Usage: node plugin/dist/cli.mjs mcp --project-root <root>');
    const project = await openProject(argv[2]);
    await createServer(project, installedRoot).connect(new StdioServerTransport());
    return 0;
  } catch (error) {
    const code = error instanceof NetworkError && /^[a-z][a-z0-9_]{0,63}$/.test(error.code) ? error.code : 'startup_failed';
    process.stderr.write(`FeatureNetwork: ${code}. ${code === 'node_24_required' ? 'Install Node.js 24 LTS.' : 'Use mcp --project-root <root> with an existing project directory.'}\n`);
    return 1;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = await runCli(process.argv.slice(2));
