let activeSessions = 0;
let onActivate: (() => void) | null = null;
let onDeactivate: (() => void) | null = null;

export function registerSessionCallbacks(activate: () => void, deactivate: () => void): void {
  onActivate = activate;
  onDeactivate = deactivate;
}

export function notifySessionStart(): void {
  activeSessions++;
  if (activeSessions === 1) onActivate?.();
}

export function notifySessionEnd(): void {
  if (activeSessions > 0) activeSessions--;
  if (activeSessions === 0) onDeactivate?.();
}
