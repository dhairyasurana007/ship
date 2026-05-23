import type { Config } from './config.js';

function inferApiTargetFromTarget(target: string): string {
  try {
    const url = new URL(target);
    if (url.hostname.includes('ship-web-') && url.hostname.endsWith('.onrender.com')) {
      return 'https://ship-api-ysxi.onrender.com';
    }
  } catch {
    // fall through to default target
  }
  return target;
}

export function getApiTarget(config: Config): string {
  return (config.apiTarget ?? inferApiTargetFromTarget(config.target)).replace(/\/$/, '');
}
