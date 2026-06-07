#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['dist', 'node_modules', 'coverage', 'test-results', '.git'].includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function rel(file) {
  return file.replace(ROOT + path.sep, '').replaceAll(path.sep, '/');
}

function checkApiBoundary(file, source) {
  if (!rel(file).startsWith('api/src/platform/api/v1/')) return [];
  const violations = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*import.*from\s+['"]([^'"]+)['"]/);
    if (!match) continue;
    const spec = match[1];
    if (spec.startsWith('../../routes/') || spec.startsWith('../../services/')) {
      violations.push(`${rel(file)}: forbidden import '${spec}'`);
    }
  }
  return violations;
}

function checkIntegrationBoundary(file, source) {
  if (!rel(file).startsWith('integrations/')) return [];
  const violations = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*import.*from\s+['"]([^'"]+)['"]/);
    if (!match) continue;
    const spec = match[1];
    if (spec.includes('api/src/')) {
      violations.push(`${rel(file)}: forbidden import '${spec}'`);
    }
  }
  return violations;
}

const violations = [];
for (const file of walk(ROOT)) {
  const source = fs.readFileSync(file, 'utf8');
  violations.push(...checkApiBoundary(file, source));
  violations.push(...checkIntegrationBoundary(file, source));
}

if (violations.length > 0) {
  console.error('Boundary lint violations:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Boundary lint OK');
