declare module '@ship-dhairya/sdk' {
  export interface ShipClientOptions {
    token: string;
    baseUrl?: string;
  }

  export interface ShipDocument {
    id: string;
    title: string;
    document_type: string;
  }

  export interface ShipUser {
    id: string;
    name: string;
    email: string;
    granted_scopes?: string[];
  }

  export class ShipClient {
    constructor(opts: ShipClientOptions);
    me(): Promise<ShipUser>;
    readonly documents: {
      create(body: {
        title: string;
        document_type?: string;
        content?: unknown;
        properties?: Record<string, unknown>;
      }): Promise<ShipDocument>;
      get(documentId: string): Promise<ShipDocument>;
      list(cursor?: string): Promise<{ data: ShipDocument[]; next_cursor: string | null }>;
    };
    static clientCredentials(opts: {
      clientId: string;
      clientSecret: string;
      baseUrl?: string;
    }): Promise<ShipClient>;
  }
}
