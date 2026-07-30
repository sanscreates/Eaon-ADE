// node-pty's prebuilt spawn-helper can lose its executable bit when extracted.
// Restore it so PTY spawning works after every install.
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const prebuilds = join(root, 'node_modules', 'node-pty', 'prebuilds');

if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper');
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
      console.log(`fixed permissions: ${helper}`);
    }
  }
}
