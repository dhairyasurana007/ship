import type { Server } from 'http';
import { loadFleetGraphConfig } from './config.js';
import { logFleetGraphError, logFleetGraphInfo } from './logger.js';

export interface FleetGraphServiceHandle {
  stop: () => Promise<void>;
}

export async function startFleetGraphService(_server: Server): Promise<FleetGraphServiceHandle | null> {
  const config = loadFleetGraphConfig();
  if (!config.enabled) {
    logFleetGraphInfo('Service disabled (set FLEETGRAPH_ENABLED=true to enable).');
    return null;
  }

  try {
    logFleetGraphInfo('Service initialized.', {
      model: config.model,
      maxConcurrency: config.maxConcurrency,
      queueSize: config.queueSize,
      pollIntervalMs: config.pollIntervalMs,
    });

    return {
      stop: async () => {
        logFleetGraphInfo('Service stopped.');
      },
    };
  } catch (error) {
    logFleetGraphError('Failed to initialize service.', error);
    throw error;
  }
}
