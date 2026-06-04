import type { IEventBus, ShipEvent } from './IEventBus.js';

export class InMemoryEventBus implements IEventBus {
  private readonly handlers: Array<(event: ShipEvent) => Promise<void>> = [];

  async publish(event: ShipEvent): Promise<void> {
    await Promise.all(this.handlers.map((h) => h(event).catch(console.error)));
  }

  subscribe(handler: (event: ShipEvent) => Promise<void>): void {
    this.handlers.push(handler);
  }
}

export const eventBus = new InMemoryEventBus();
