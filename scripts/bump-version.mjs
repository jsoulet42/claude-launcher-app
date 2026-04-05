#!/usr/bin/env node
// bump-version.mjs — bump version in all 5 project files
// Usage: node scripts/bump-version.mjs 1.2.0

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('Usage: node scripts/bump-version.mjs X.Y.Z');
  console.error('Example: node scripts/bump-version.mjs 1.2.0');
  process.exit(1);
}

const files = [
  {
    path: resolve(ROOT, 'package.json'),
    update: (content) => content.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`),
  },
  {
    path: resolve(ROOT, 'package-lock.json'),
    update: (content) => {
      // 2 occurrences: root + packages[""]
      return content
        .replace(/("name":\s*"claude-launcher",\s*\n\s*"version":\s*)"[^"]+"/, `$1"${newVersion}"`)
        .replace(/("":\s*{\s*\n\s*"name":\s*"claude-launcher",\s*\n\s*"version":\s*)"[^"]+"/, `$1"${newVersion}"`);
    },
  },
  {
    path: resolve(ROOT, 'src-tauri', 'tauri.conf.json'),
    update: (content) => content.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`),
  },
  {
    path: resolve(ROOT, 'src-tauri', 'Cargo.toml'),
    update: (content) => content.replace(/^(name\s*=\s*"claude-launcher"\s*\nversion\s*=\s*)"[^"]+"/m, `$1"${newVersion}"`),
  },
  {
    path: resolve(ROOT, 'src-tauri', 'Cargo.lock'),
    update: (content) => content.replace(/(name\s*=\s*"claude-launcher"\s*\nversion\s*=\s*)"[^"]+"/, `$1"${newVersion}"`),
  },
];

let oldVersion = null;
for (const file of files) {
  const content = readFileSync(file.path, 'utf-8');
  const match = content.match(/(?:"version":\s*"|version\s*=\s*")(\d+\.\d+\.\d+)/);
  if (match && !oldVersion) oldVersion = match[1];
  const updated = file.update(content);
  if (updated === content) {
    console.error(`WARN: no change in ${file.path}`);
  }
  writeFileSync(file.path, updated);
  console.log(`  ✓ ${file.path.replace(ROOT, '.')}`);
}

console.log(`\nVersion bumped: ${oldVersion} → ${newVersion}`);
