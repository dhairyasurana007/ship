import { beforeAll, afterAll } from 'vitest'
import { pool } from '../db/client.js'

// Test setup for API integration tests
// This runs before all tests in each test file

beforeAll(async () => {
  // Ensure test environment
  process.env.NODE_ENV = 'test'

  // Clean up test data from previous runs to prevent duplicate key errors
  // Use TRUNCATE CASCADE which is faster and bypasses row-level triggers
  // (audit_logs has AU-9 compliance triggers preventing DELETE)
  // Wrapped in try-catch so pure unit tests can run without a live DB connection.
  try {
    await pool.query(`TRUNCATE TABLE
      workspace_invites, sessions, files, document_links, document_history,
      comments, document_associations, document_snapshots, sprint_iterations,
      issue_iterations, documents, audit_logs, workspace_memberships,
      users, workspaces
      CASCADE`)
  } catch {
    // DB not available — skip truncation. Integration tests will fail naturally
    // if they need a DB; pure unit tests can proceed without one.
  }
})

afterAll(async () => {
  // Close pool only at the very end - vitest handles this via globalTeardown
})
