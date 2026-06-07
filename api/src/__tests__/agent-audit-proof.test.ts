import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShipClient } from '@ship/sdk';
import {
  FLEETGRAPH_AGENT_CLIENT_ID,
  FLEETGRAPH_AGENT_CLIENT_SECRET,
  FLEETGRAPH_AGENT_USER_ID,
} from '../fleetgraph/public-api.js';

const API_URL = process.env['SHIP_API_BASE_URL'] ?? 'https://ship-api-ysxi.onrender.com';
const AUDIT_DATABASE_URL = process.env['SHIP_AUDIT_DATABASE_URL'];

const auditPool = AUDIT_DATABASE_URL ? new Pool({ connectionString: AUDIT_DATABASE_URL }) : null;

beforeAll(async () => {
  if (!auditPool) {
    console.log('Skipping agent audit proof — SHIP_AUDIT_DATABASE_URL not set');
  }
});

afterAll(async () => {
  if (auditPool) {
    await auditPool.end();
  }
});

async function waitForAuditRow(clientId: string): Promise<Array<Record<string, unknown>>> {
  if (!auditPool) {
    return [];
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await auditPool.query(
      `SELECT client_id, user_id, route, http_status, created_at
       FROM public_api_audit
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [clientId]
    );
    if (result.rowCount && result.rowCount > 0) {
      return result.rows as Array<Record<string, unknown>>;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return [];
}

describe('agent audit proof', () => {
  it('routes agent actions through the public API and logs the client id', async () => {
    if (!auditPool) {
      return;
    }

    const client = await ShipClient.clientCredentials({
      baseUrl: API_URL,
      clientId: FLEETGRAPH_AGENT_CLIENT_ID,
      clientSecret: FLEETGRAPH_AGENT_CLIENT_SECRET,
    });

    await expect(client.me()).rejects.toMatchObject({ kind: 'auth' });

    const created = await client.documents.create({
      title: 'Agent proof document',
      document_type: 'wiki',
    });

    expect(created.title).toBe('Agent proof document');

    const auditRows = await waitForAuditRow(FLEETGRAPH_AGENT_CLIENT_ID);
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0]?.client_id).toBe(FLEETGRAPH_AGENT_CLIENT_ID);
    expect(auditRows[0]?.user_id).toBe(FLEETGRAPH_AGENT_USER_ID);
    expect(auditRows[0]?.route).toBe('/docs');
  });
});
