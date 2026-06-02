#!/usr/bin/env node
import { spawn } from 'node:child_process';

const [, , target, ...extraArgs] = process.argv;
const filter = target
  ? (target.startsWith('.') || target.startsWith('@') ? target : `./${target}`)
  : null;

const args = filter
  ? ['--filter', filter, 'run', 'lint', ...extraArgs]
  : ['--recursive', 'run', 'lint', ...extraArgs];

const quote = (value) => {
  if (/[\s"&|<>^]/.test(value)) {
    return `"${value.replaceAll('"', '\\"')}"`;
  }

  return value;
};

const child = spawn(
  process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm',
  process.platform === 'win32'
    ? ['/d', '/s', '/c', ['pnpm', ...args].map(quote).join(' ')]
    : args,
  { stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
