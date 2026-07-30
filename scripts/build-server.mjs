// Bundle the server into a single ESM file so the Electron app can run it
// without tsx. npm packages stay external and resolve from node_modules.
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(root, 'server/src/index.ts')],
  outfile: join(root, 'server/dist/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

// The memory MCP server ships as a second, fully self-contained entry point.
// Agent CLIs spawn it themselves with plain `node`, from outside the app — so
// unlike the server above it cannot rely on node_modules being anywhere near
// it, and `packages: 'external'` would be a landmine. It imports nothing but
// node built-ins, so bundling everything costs nothing.
await build({
  entryPoints: [join(root, 'server/src/memory/mcp.ts')],
  outfile: join(root, 'server/dist/memory-mcp.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
});
