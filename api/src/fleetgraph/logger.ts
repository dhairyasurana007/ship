export function logFleetGraphInfo(message: string, metadata?: Record<string, unknown>): void {
  if (metadata) {
    console.log(`[FleetGraph] ${message}`, metadata);
    return;
  }
  console.log(`[FleetGraph] ${message}`);
}

export function logFleetGraphError(message: string, error: unknown): void {
  console.error(`[FleetGraph] ${message}`, error);
}
