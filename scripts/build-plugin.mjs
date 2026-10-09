import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('plugin/dist', { recursive: true });
await build({ entryPoints: ['src/cli.ts'], outfile: 'plugin/dist/cli.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: false, legalComments: 'eof', banner: { js: "import { createRequire as __fnCreateRequire } from 'node:module'; const require = __fnCreateRequire(import.meta.url);" } });
