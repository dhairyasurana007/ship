import { describe, expect, it } from 'vitest';
import { FleetGraphTriggerQueue } from '../fleetgraph/trigger-queue.js';

describe('fleetgraph trigger queue', () => {
  it('honors FIFO ordering with bounded concurrency', async () => {
    const started: string[] = [];
    const released: Array<() => void> = [];

    const queue = new FleetGraphTriggerQueue(2, 10, async (envelope) => {
      started.push(envelope.runId);
      await new Promise<void>((resolve) => released.push(resolve));
    });

    queue.enqueue({ runId: 'r1', triggerType: 'pg_event', payload: {}, createdAt: new Date().toISOString() });
    queue.enqueue({ runId: 'r2', triggerType: 'pg_event', payload: {}, createdAt: new Date().toISOString() });
    queue.enqueue({ runId: 'r3', triggerType: 'pg_event', payload: {}, createdAt: new Date().toISOString() });

    expect(started).toEqual(['r1', 'r2']);
    expect(queue.active).toBe(2);
    expect(queue.size).toBe(1);

    released.shift()?.();
    await new Promise((r) => setTimeout(r, 0));

    expect(started).toEqual(['r1', 'r2', 'r3']);
  });
});

