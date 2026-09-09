import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
rmSync(path.join(root, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
function assets(relative = '') {
  for (const entry of readdirSync(path.join(root, 'src', relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) { if (entry.name !== '__pycache__') assets(name); }
    else if (!/\.(?:ts|pyc)$/.test(entry.name)) {
      const target = path.join(root, 'dist', name);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(root, 'src', name), target);
    }
  }
}
assets();
