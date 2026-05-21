import { parseArgs } from 'node:util';

export interface Config {
  target: string;
  output: string;
  verbose: boolean;
  timeout: number;
  repo: string | null;
  adminEmail: string | null;
  adminPassword: string | null;
}

export function parseConfig(): Config {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      output: { type: 'string', default: 'security-probe/reports' },
      verbose: { type: 'boolean', default: false },
      timeout: { type: 'string', default: '10000' },
      repo: { type: 'string' },
      'admin-email': { type: 'string' },
      'admin-password': { type: 'string' }
    }
  });

  const target = positionals[0];
  if (!target) {
    console.error('Usage: ship-security-probe <target-url> [options]');
    console.error(
      'Example: ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com'
    );
    process.exit(1);
  }

  return {
    target: target.replace(/\/$/, ''),
    output: values.output as string,
    verbose: values.verbose as boolean,
    timeout: parseInt(values.timeout as string, 10),
    repo: (values.repo as string | undefined) ?? null,
    adminEmail: (values['admin-email'] as string | undefined) ?? null,
    adminPassword: (values['admin-password'] as string | undefined) ?? null
  };
}
