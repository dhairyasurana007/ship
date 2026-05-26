import { describe, expect, it, vi } from 'vitest';
import { classifyConditions } from '../fleetgraph/classify-conditions.js';
import type { FleetGraphIssueRecord } from '../fleetgraph/types.js';

function issue(overrides: Partial<FleetGraphIssueRecord>): FleetGraphIssueRecord {
  return {
    id: 'i1',
    workspaceId: 'w1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    state: 'todo',
    sprintId: null,
    projectId: 'p1',
    hasBlockerText: false,
    blockerUpdatedAt: null,
    ...overrides,
  };
}

describe('fleetgraph proactive classification', () => {
  it('applies stale threshold math', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T01:00:00.000Z'));
    const conditions = classifyConditions([issue({ updatedAt: '2026-01-02T00:00:00.000Z' })]);
    expect(conditions.find((c) => c.type === 'stale_issue')).toBeDefined();
    vi.useRealTimers();
  });

  it('resets blocker timer when blockerUpdatedAt is recent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T01:00:00.000Z'));
    const conditions = classifyConditions([
      issue({
        hasBlockerText: true,
        blockerUpdatedAt: '2026-01-03T00:30:00.000Z',
      }),
    ]);
    expect(conditions.find((c) => c.type === 'unresolved_blocker')).toBeUndefined();
    vi.useRealTimers();
  });

  it('excludes terminal-state issues from orphan detection', () => {
    const conditions = classifyConditions([issue({ state: 'done', projectId: null, sprintId: null })]);
    expect(conditions.find((c) => c.type === 'orphaned_issue')).toBeUndefined();
  });

  it('detects scope creep when sprint assignment appears on older issue', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T00:00:00.000Z'));
    const conditions = classifyConditions([
      issue({
        createdAt: '2026-01-01T00:00:00.000Z',
        sprintId: 's1',
      }),
    ]);
    expect(conditions.find((c) => c.type === 'sprint_scope_creep')).toBeDefined();
    vi.useRealTimers();
  });
});
