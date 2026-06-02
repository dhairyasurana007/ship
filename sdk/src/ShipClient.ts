import { deviceLoginFlow, type DeviceLoginOptions } from './auth/DeviceFlow.js';
import { DocumentsClient } from './resources/DocumentsClient.js';
import { MeClient } from './resources/MeClient.js';

export interface ShipClientOptions {
  token: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://ship-api-ysxi.onrender.com';

export class ShipClient {
  private readonly baseUrl: string;
  private readonly token: string;
  readonly me: MeClient;
  readonly documents: DocumentsClient;

  constructor(opts: ShipClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.me = new MeClient(this.baseUrl, this.token);
    this.documents = new DocumentsClient(this.baseUrl, this.token);
  }

  static async deviceLogin(opts: DeviceLoginOptions): Promise<ShipClient> {
    const accessToken = await deviceLoginFlow(opts);
    return new ShipClient({
      token: accessToken,
      baseUrl: opts.baseUrl,
    });
  }
}
