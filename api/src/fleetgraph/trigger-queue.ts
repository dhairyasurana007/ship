import type { FleetGraphRunEnvelope } from './types.js';

type QueueHandler = (envelope: FleetGraphRunEnvelope) => Promise<void>;

export class FleetGraphTriggerQueue {
  private readonly queue: FleetGraphRunEnvelope[] = [];
  private inFlight = 0;

  constructor(
    private readonly maxConcurrency: number,
    private readonly maxSize: number,
    private readonly handler: QueueHandler
  ) {}

  enqueue(envelope: FleetGraphRunEnvelope): boolean {
    if (this.queue.length >= this.maxSize) {
      return false;
    }
    this.queue.push(envelope);
    this.drain();
    return true;
  }

  get size(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.inFlight;
  }

  private drain(): void {
    while (this.inFlight < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) return;
      this.inFlight += 1;
      void this.handler(next)
        .catch(() => {
          // Handler failures are captured by run status updates upstream.
        })
        .finally(() => {
          this.inFlight -= 1;
          this.drain();
        });
    }
  }
}

