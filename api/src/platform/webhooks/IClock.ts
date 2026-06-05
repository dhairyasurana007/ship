export interface IClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export class WallClock implements IClock {
  now(): number { return Date.now(); }
  sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
}

export class FakeClock implements IClock {
  private _now: number;
  private readonly scheduled: Array<{ at: number; resolve: () => void }> = [];

  constructor(startMs = 0) { this._now = startMs; }

  now(): number { return this._now; }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.scheduled.push({ at: this._now + ms, resolve });
    });
  }

  advance(ms: number): void {
    this._now += ms;
    const due = this.scheduled.filter((s) => s.at <= this._now);
    due.forEach((s) => s.resolve());
    this.scheduled.splice(0, this.scheduled.length, ...this.scheduled.filter((s) => s.at > this._now));
  }
}
