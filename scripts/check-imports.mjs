/** Detect missing relative JavaScript import/export files before deploying. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['src', 'tests', 'bridge'];
const errors = [];

function checkDirectory(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      checkDirectory(path);
      continue;
    }
    if (!/\.(m?js)$/.test(entry.name)) continue;
    const source = readFileSync(path, 'utf8');
    const references = [
      ...source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ];
    for (const [, relative] of references) {
      const target = resolve(dirname(path), relative);
      if (![target, `${target}.js`, `${target}.mjs`, join(target, 'index.js')].some(existsSync)) {
        errors.push(`${path.slice(root.length + 1)} → ${relative}`);
      }
    }
  }
}

for (const directory of roots) checkDirectory(join(root, directory));
if (errors.length) {
  console.error(`相対importの参照先が見つかりません:\n${errors.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('OK: 相対importの参照先はすべて存在します。');
}
