import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Report } from '../types.js';

export async function writeMarkdown(report: Report, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = resolve(join(outputDir, 'security-probe-report.md'));
  const content = `# Shipshape Security Audit Report

Generated: ${report.generated}
Target: ${report.target}

No findings yet.
`;
  await writeFile(filePath, content, 'utf8');
  return filePath;
}
