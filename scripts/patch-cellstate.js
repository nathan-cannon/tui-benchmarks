// Patches cellstate's compiled output after npm install:
// 1. frame-loop.js: replace writeFileSync(1, ...) with stdout.write(...)
//    so stop() doesn't write escape seqs to fd 1 during benchmarks.
// 2. package.json: add wildcard export so pipeline benchmark can import
//    internal modules like cellstate/dist/tui/reconciler.js.

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'node_modules/cellstate';

// Patch frame-loop.js
const flPath = `${BASE}/dist/tui/frame-loop.js`;
try {
  let fl = readFileSync(flPath, 'utf8');
  fl = fl.replace('writeFileSync(1,', 'stdout.write(');
  writeFileSync(flPath, fl);
} catch {}

// Patch package.json exports
const pkgPath = `${BASE}/package.json`;
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.exports['./dist/*']) {
    pkg.exports['./dist/*'] = './dist/*';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
} catch {}
