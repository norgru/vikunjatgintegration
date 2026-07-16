import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
rmSync(resolve(projectRoot, 'dist'), { recursive: true, force: true });
execFileSync(
  process.execPath,
  [resolve(projectRoot, 'node_modules/typescript/bin/tsc'), '-p', resolve(projectRoot, 'tsconfig.build.json')],
  { cwd: projectRoot, stdio: 'inherit' },
);
