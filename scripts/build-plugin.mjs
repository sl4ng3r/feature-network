import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('plugin/dist', { recursive: true });
await build({ entryPoints: { cli: 'src/cli.ts', hook: 'src/adapters/hook-main.ts' }, outdir: 'plugin/dist', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: false, legalComments: 'eof', banner: { js: "import { createRequire as __fnCreateRequire } from 'node:module'; const require = __fnCreateRequire(import.meta.url);" } });
