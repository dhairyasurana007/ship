import { MeClient } from './resources/MeClient.js';
import { ShipError } from './errors.js';

export interface ShipClientOptions {
  token: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://ship-api-ysxi.onrender.com';

export class ShipClient {
  private readonly baseUrl: string;
  private readonly token: string;
  readonly me: MeClient;

  constructor(opts: ShipClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.me = new MeClient(this.baseUrl, this.token);
  }
}

export { ShipError };
