import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';

describe('Internal Probe API', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const probeEmail = `probe-${testRunId}@probe.local`;
  const nonProbeEmail = `member-${testRunId}@ship.local`;
  const token = `token-${testRunId}`;
  const originalEnabled = process.env.PROBE_INTERNAL_ELEVATION_ENABLED;
  const originalToken = process.env.PROBE_INTERNAL_ELEVATION_TOKEN;
  const originalAllowlist = process.env.PROBE_INTERNAL_ELEVATION_IP_ALLOWLIST;

  let probeUserId: string;
  let nonProbeUserId: string;

  beforeAll(async () => {
    const probeUser = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, NULL, 'Probe Test User')
       RETURNING id`,
      [probeEmail]
    );
    probeUserId = probeUser.rows[0].id;

    const nonProbeUser = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, NULL, 'Non Probe Test User')
       RETURNING id`,
      [nonProbeEmail]
    );
    nonProbeUserId = nonProbeUser.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM internal_probe_admin_elevations WHERE user_id IN ($1, $2)', [probeUserId, nonProbeUserId]);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [probeUserId, nonProbeUserId]);

    process.env.PROBE_INTERNAL_ELEVATION_ENABLED = originalEnabled;
    process.env.PROBE_INTERNAL_ELEVATION_TOKEN = originalToken;
    process.env.PROBE_INTERNAL_ELEVATION_IP_ALLOWLIST = originalAllowlist;
  });

  beforeEach(async () => {
    process.env.PROBE_INTERNAL_ELEVATION_ENABLED = 'true';
    process.env.PROBE_INTERNAL_ELEVATION_TOKEN = token;
    delete process.env.PROBE_INTERNAL_ELEVATION_IP_ALLOWLIST;
    await pool.query('DELETE FROM internal_probe_admin_elevations WHERE user_id IN ($1, $2)', [probeUserId, nonProbeUserId]);
  });

  afterEach(() => {
    process.env.PROBE_INTERNAL_ELEVATION_ENABLED = originalEnabled;
    process.env.PROBE_INTERNAL_ELEVATION_TOKEN = originalToken;
    process.env.PROBE_INTERNAL_ELEVATION_IP_ALLOWLIST = originalAllowlist;
  });

  it('returns 404 when disabled', async () => {
    process.env.PROBE_INTERNAL_ELEVATION_ENABLED = 'false';
    const res = await request(app)
      .post('/api/internal/probe/elevate-admin')
      .set('authorization', `Bearer ${token}`)
      .send({ email: probeEmail, ttlMinutes: 5 });

    expect(res.status).toBe(404);
  });

  it('rejects wrong token', async () => {
    const res = await request(app)
      .post('/api/internal/probe/elevate-admin')
      .set('authorization', 'Bearer wrong-token')
      .send({ email: probeEmail, ttlMinutes: 5 });

    expect(res.status).toBe(401);
  });

  it('rejects non-probe emails', async () => {
    const res = await request(app)
      .post('/api/internal/probe/elevate-admin')
      .set('authorization', `Bearer ${token}`)
      .send({ email: nonProbeEmail, ttlMinutes: 5 });

    expect(res.status).toBe(400);
  });

  it('creates temporary elevation for probe email', async () => {
    const res = await request(app)
      .post('/api/internal/probe/elevate-admin')
      .set('authorization', `Bearer ${token}`)
      .send({ email: probeEmail, ttlMinutes: 5 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(probeEmail);

    const elevation = await pool.query(
      `SELECT user_id, expires_at
       FROM internal_probe_admin_elevations
       WHERE user_id = $1`,
      [probeUserId]
    );
    expect(elevation.rows.length).toBe(1);
  });

  it('cleans up probe-test-* users via internal endpoint', async () => {
    const cleanupEmail = `probe-test-${testRunId}@probe.local`;
    const cleanupUser = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, NULL, 'Probe Cleanup User')
       RETURNING id`,
      [cleanupEmail]
    );
    const cleanupUserId = cleanupUser.rows[0].id as string;

    const res = await request(app)
      .post('/api/internal/probe/cleanup-test-users')
      .set('authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deletedCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.data.deleted)).toBe(true);

    const verify = await pool.query('SELECT id FROM users WHERE id = $1', [cleanupUserId]);
    expect(verify.rows.length).toBe(0);
  });
});
