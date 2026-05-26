import type { Server } from 'http';
import { loadFleetGraphConfig } from './config.js';
import { logFleetGraphError, logFleetGraphInfo } from './logger.js';
import { FleetGraphTriggerRuntime } from './trigger-runtime.js';

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
    const runtime = new FleetGraphTriggerRuntime(config);
    await runtime.start();

    logFleetGraphInfo('Service initialized.', {
      provider: config.provider,
      model: config.model,
      openRouterBaseUrl: config.provider === 'openrouter' ? config.openRouterBaseUrl : undefined,
      maxConcurrency: config.maxConcurrency,
      queueSize: config.queueSize,
      pollIntervalMs: config.pollIntervalMs,
    });

    return {
      stop: async () => {
        await runtime.stop();
        logFleetGraphInfo('Service stopped.');
      },
    };
  } catch (error) {
    logFleetGraphError('Failed to initialize service.', error);
    throw error;
  }
}
