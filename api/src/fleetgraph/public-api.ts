import type { ShipClient } from '@ship-dhairya/sdk';

export const FLEETGRAPH_AGENT_APP_NAME = 'FleetGraph Agent';
export const FLEETGRAPH_AGENT_USER_ID = '00000000-0000-0000-0000-0000000007f1';
export const FLEETGRAPH_AGENT_CLIENT_ID = '00000000-0000-0000-0000-0000000007f2';
export const FLEETGRAPH_AGENT_CLIENT_SECRET = 'fleetgraph-agent-secret';

const DEFAULT_PUBLIC_API_BASE_URL = 'https://ship-api-ysxi.onrender.com';

let clientPromise: Promise<ShipClient> | null = null;

export function shouldUsePublicApi(): boolean {
  return process.env.AGENT_USE_PUBLIC_API === 'true';
}

export async function getFleetGraphPublicClient(): Promise<ShipClient> {
  if (!shouldUsePublicApi()) {
    throw new Error('AGENT_USE_PUBLIC_API is disabled');
  }

  if (!clientPromise) {
    const { ShipClient } = await import('@ship-dhairya/sdk');
    clientPromise = ShipClient.clientCredentials({
      clientId: FLEETGRAPH_AGENT_CLIENT_ID,
      clientSecret: FLEETGRAPH_AGENT_CLIENT_SECRET,
      baseUrl: process.env.SHIP_API_BASE_URL ?? DEFAULT_PUBLIC_API_BASE_URL,
    });
  }

  return clientPromise;
}
