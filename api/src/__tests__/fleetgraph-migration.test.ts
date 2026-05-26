import { describe, expect, it } from 'vitest';
import { pool } from '../db/client.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('fleetgraph migration smoke', () => {
  it('creates fleetgraph tables and supports basic read/write', async () => {
    const migrationPath = join(process.cwd(), 'src', 'db', 'migrations', '042_fleetgraph_mvp_tables.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    await pool.query(sql);

    const tableCheck = await pool.query(
      `SELECT to_regclass('public.fleetgraph_runs') as runs_table,
              to_regclass('public.fleetgraph_state') as state_table`
    );

    expect(tableCheck.rows[0]?.runs_table).toBe('fleetgraph_runs');
    expect(tableCheck.rows[0]?.state_table).toBe('fleetgraph_state');

    const runId = `test-run-${Date.now()}`;
    await pool.query(
      `INSERT INTO fleetgraph_runs (run_id, trigger_type, status, payload)
       VALUES ($1, 'pg_event', 'queued', '{}'::jsonb)`,
      [runId]
    );

    const inserted = await pool.query('SELECT run_id, status FROM fleetgraph_runs WHERE run_id = $1', [runId]);
    expect(inserted.rows[0]?.run_id).toBe(runId);
    expect(inserted.rows[0]?.status).toBe('queued');
  });
});
