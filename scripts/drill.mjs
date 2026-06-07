import { spawnSync } from 'node:child_process';
import process from 'node:process';

const drillName = process.argv[2];

if (!drillName) {
  console.error('Usage: pnpm drill <name>');
  process.exit(1);
}

const drillMap = {
  ttfe: ['--filter', '@ship-dhairya/cli', 'exec', 'vitest', 'run', 'tests/ttfe.drill.ts'],
  idempotency: ['--filter', '@ship-dhairya/cli', 'exec', 'vitest', 'run', 'tests/idempotency.drill.ts'],
  'stolen-token': ['--filter', '@ship-dhairya/cli', 'exec', 'vitest', 'run', 'tests/stolen-token.drill.ts'],
};

const args = drillMap[drillName];

if (!args) {
  console.error(`Unknown drill "${drillName}".`);
  process.exit(1);
}

const result = spawnSync('pnpm', args, { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
