export interface CleanupTask {
  label: string;
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];

export function registerCleanupTask(task: CleanupTask): void {
  cleanupTasks.push(task);
}

export function getCleanupTasks(): CleanupTask[] {
  return [...cleanupTasks];
}

export function resetCleanupTasks(): void {
  cleanupTasks.length = 0;
}
