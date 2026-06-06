import { deviceLoginFlow, type DeviceLoginOptions } from "./auth/DeviceFlow.js";
import {
  AuthorizationCodeFlow,
  type AuthCodeFlowOptions,
} from "./auth/AuthorizationCodeFlow.js";
import { DocumentsClient } from "./resources/DocumentsClient.js";
import { IssuesClient } from "./resources/IssuesClient.js";
import { SprintsClient } from "./resources/SprintsClient.js";
import { WebhooksClient } from "./resources/WebhooksClient.js";
import { MeClient } from "./resources/MeClient.js";
import type { User } from "./types.js";

export interface ShipClientOptions {
  token: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL =
  process.env["SHIP_API_BASE_URL"] ?? "https://ship-api-ysxi.onrender.com";

export class ShipClient {
  private readonly baseUrl: string;
  private readonly token: string;
  readonly meClient: MeClient;
  readonly documents: DocumentsClient;
  readonly issues: IssuesClient;
  readonly sprints: SprintsClient;
  readonly webhooks: WebhooksClient;

  constructor(opts: ShipClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.meClient = new MeClient(this.baseUrl, this.token);
    this.documents = new DocumentsClient(this.baseUrl, this.token);
    this.issues = new IssuesClient(this.baseUrl, this.token);
    this.sprints = new SprintsClient(this.baseUrl, this.token);
    this.webhooks = new WebhooksClient(this.baseUrl, this.token);
  }

  async me(): Promise<User> {
    return this.meClient.me();
  }

  static async deviceLogin(opts: DeviceLoginOptions): Promise<ShipClient> {
    const accessToken = await deviceLoginFlow(opts);
    return new ShipClient({ token: accessToken, baseUrl: opts.baseUrl });
  }

  static authorizationCodeFlow(opts: AuthCodeFlowOptions): AuthorizationCodeFlow {
    return new AuthorizationCodeFlow(opts);
  }
}
