export interface ShipEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface IEventBus {
  publish(event: ShipEvent): Promise<void>;
  subscribe(handler: (event: ShipEvent) => Promise<void>): void;
}
