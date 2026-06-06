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

const run = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      if ((code ?? 1) !== 0) {
        reject(new Error(`Command failed: ${command} ${commandArgs.join(' ')}`));
        return;
      }
      resolve();
    });
  });

const pnpmCommand = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
const pnpmArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', ['pnpm', ...args].map(quote).join(' ')]
  : args;

try {
  await run(pnpmCommand, pnpmArgs);
  await run('node', ['scripts/check-boundaries.mjs']);
} catch (error) {
  process.exitCode = 1;
}
