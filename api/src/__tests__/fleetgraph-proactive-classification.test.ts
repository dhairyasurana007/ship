import { describe, expect, it, vi } from 'vitest';
import { classifyCapacityMismatch, classifyConditions } from '../fleetgraph/classify-conditions.js';
import type { FleetGraphIssueRecord } from '../fleetgraph/types.js';

function issue(overrides: Partial<FleetGraphIssueRecord>): FleetGraphIssueRecord {
  return {
    id: 'i1',
    workspaceId: 'w1',
    title: null,
    assigneeId: null,
    assigneeName: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    state: 'todo',
    sprintId: null,
    sprintTitle: null,
    projectId: 'p1',
    projectTitle: null,
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

  it('classifyCapacityMismatch detects when free members and orphaned issues coexist', () => {
    const conditions = classifyCapacityMismatch([
      // u1 has only a done issue — they appear as a team member but have no active assignment
      issue({ id: 'i1', projectId: 'p1', state: 'done', assigneeId: 'u1', sprintId: null }),
      // orphaned: non-terminal, no assignee, no sprint
      issue({ id: 'i2', projectId: 'p1', state: 'todo', assigneeId: null, sprintId: null }),
    ]);
    const match = conditions.find((c) => c.type === 'capacity_mismatch');
    expect(match).toBeDefined();
    expect((match!.details.freeMemberCount as number) >= 1).toBe(true);
    expect((match!.details.orphanCount as number) >= 1).toBe(true);
  });

  it('classifyCapacityMismatch returns empty when no orphaned issues', () => {
    const conditions = classifyCapacityMismatch([
      issue({ id: 'i1', projectId: 'p1', state: 'in_progress', assigneeId: 'u1', sprintId: 's1' }),
      issue({ id: 'i2', projectId: 'p1', state: 'todo', assigneeId: 'u2', sprintId: 's1' }),
    ]);
    expect(conditions).toEqual([]);
  });

  it('classifyCapacityMismatch ignores issues with no projectId', () => {
    const conditions = classifyCapacityMismatch([
      issue({ id: 'i1', projectId: null, state: 'in_progress', assigneeId: 'u1' }),
      issue({ id: 'i2', projectId: null, state: 'todo', assigneeId: null }),
    ]);
    expect(conditions).toEqual([]);
  });
});
