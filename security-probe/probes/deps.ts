import * as childProcess from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from '../config.js';
import type { Finding } from '../types.js';

type Advisory = {
  id?: number;
  title?: string;
  module_name?: string;
  severity?: string;
  cves?: string[];
  vulnerable_versions?: string;
  patched_versions?: string;
  overview?: string;
  findings?: Array<{ version?: string }>;
};

type AuditJson = {
  advisories?: Record<string, Advisory>;
};

let execSyncImpl: typeof childProcess.execSync = childProcess.execSync;

export function __setExecSyncForTests(
  fn: typeof childProcess.execSync | null
): void {
  execSyncImpl = fn ?? childProcess.execSync;
}

export function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, 'pnpm-lock.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        'Could not find pnpm-lock.yaml. Run from inside the Ship repo, or pass --repo <path>.'
      );
    }
    current = parent;
  }
}

export function parseAuditJson(stdout: string): Advisory[] {
  const parsed = JSON.parse(stdout) as AuditJson;
  return Object.values(parsed.advisories ?? {});
}

export function filterHighCritical(advisories: Advisory[]): Advisory[] {
  return advisories.filter((a) => a.severity === 'high' || a.severity === 'critical');
}

function mapFeatureFromFiles(files: string[]): string {
  const featureMap: Array<{ fragment: string; label: string }> = [
    { fragment: 'api/src/routes/auth', label: 'Authentication' },
    { fragment: 'api/src/routes/documents', label: 'Document editing' },
    { fragment: 'api/src/collaboration', label: 'Real-time collaboration' },
    { fragment: 'api/src/routes/files', label: 'File uploads' },
    { fragment: 'web/src', label: 'Frontend' }
  ];
  for (const { fragment, label } of featureMap) {
    if (files.some((f) => f.includes(fragment))) {
      return label;
    }
  }
  return 'Unknown feature';
}

function grepImportFiles(repoRoot: string, moduleName: string): string[] {
  const escaped = moduleName.replace(/'/g, "\\'");
  try {
    const out = execSyncImpl(`rg -l "from '${escaped}'" "${repoRoot}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function probeDeps(config: Config): Promise<Finding[]> {
  try {
    const repoRoot = config.repo ?? findRepoRoot(process.cwd());
    let stdout = '';

    try {
      stdout = execSyncImpl('pnpm audit --json', {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
      });
    } catch (err: unknown) {
      stdout = (err as { stdout?: string }).stdout ?? '';
    }

    if (!stdout.trim()) {
      return [
        {
          id: 'DEP-000',
          category: 'dependency',
          title: 'pnpm audit returned no output',
          severity: 'info',
          status: 'inconclusive',
          description: 'pnpm audit produced no JSON output.',
          reproduction: 'Run: pnpm audit --json',
          evidence: {
            expected: 'JSON output from pnpm audit',
            actual: '(empty output)'
          },
          remediation: 'Ensure pnpm is installed and node_modules are available.'
        }
      ];
    }

    const advisories = parseAuditJson(stdout);
    const relevant = filterHighCritical(advisories);

    if (relevant.length === 0) {
      return [
        {
          id: 'DEP-000',
          category: 'dependency',
          title: 'No high or critical CVEs found',
          severity: 'info',
          status: 'pass',
          description: 'pnpm audit found no high or critical advisories.',
          reproduction: 'Run: pnpm audit',
          evidence: {
            expected: 'No high/critical advisories',
            actual: `${advisories.length} total advisories, 0 high/critical`
          },
          remediation: 'No action required.'
        }
      ];
    }

    return relevant.map((advisory, index) => {
      const moduleName = advisory.module_name ?? 'unknown-package';
      const affectedVersion = advisory.findings?.[0]?.version ?? 'unknown';
      const matchedFiles = grepImportFiles(repoRoot, moduleName);
      const affectedFeature = mapFeatureFromFiles(matchedFiles);
      const patched = advisory.patched_versions ?? 'latest';
      const vulnerableVersions = advisory.vulnerable_versions ?? 'unknown';
      const advisoryId = advisory.id != null ? String(advisory.id) : 'unknown';

      return {
        id: `DEP-${String(index + 1).padStart(3, '0')}`,
        category: 'dependency',
        title: advisory.title ?? `Vulnerability in ${moduleName}`,
        severity: advisory.severity === 'critical' ? 'critical' : 'high',
        status: 'vulnerable',
        description: advisory.overview ?? 'Dependency vulnerability detected by pnpm audit.',
        reproduction: `Run: pnpm audit\nAdvisory ID: ${advisoryId}\nPackage: ${moduleName}@${affectedVersion}`,
        evidence: {
          expected: `${moduleName} version >= ${patched}`,
          actual: `${moduleName} version ${affectedVersion} (vulnerable: ${vulnerableVersions})`
        },
        remediation: `Upgrade ${moduleName} to ${patched}. Run: pnpm update ${moduleName}`,
        cve: advisory.cves?.[0],
        affectedFeature
      };
    });
  } catch (err: unknown) {
    return [
      {
        id: 'DEP-ERR',
        category: 'dependency',
        title: 'Dependency probe failed',
        severity: 'info',
        status: 'inconclusive',
        description: 'The dependency probe failed to complete.',
        reproduction: 'Run ship-security-probe from inside the Ship repo or pass --repo.',
        evidence: {
          expected: 'Successful pnpm audit execution',
          actual: err instanceof Error ? err.message : String(err)
        },
        remediation: 'Ensure pnpm and repo path are correct and rerun the probe.'
      }
    ];
  }
}
