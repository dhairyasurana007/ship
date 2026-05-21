import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Report } from '../types.js';

export async function writeJson(report: Report, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = resolve(join(outputDir, 'security-probe-report.json'));
  await writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}
