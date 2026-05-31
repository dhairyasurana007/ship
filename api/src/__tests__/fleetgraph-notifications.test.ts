import { describe, expect, it } from 'vitest';
import { routeOutputs, conditionTitle, conditionMessage } from '../fleetgraph/notifications.js';
import type { FleetGraphCondition } from '../fleetgraph/types.js';

function c(type: FleetGraphCondition['type'], details: Record<string, unknown> = {}): FleetGraphCondition {
  return {
    type,
    severity: 'warning',
    entityId: 'i1',
    workspaceId: 'w1',
    details,
  };
}

describe('fleetgraph notification routing', () => {
  it('routes each notification-only condition separately', () => {
    const outputs = routeOutputs([c('stale_issue'), c('sprint_scope_creep')]);
    expect(outputs).toHaveLength(2);
    expect(outputs[0]!.kind).toBe('notification');
    expect(outputs[1]!.kind).toBe('notification');
  });

  it('splits notification and action-required outputs', () => {
    const outputs = routeOutputs([c('stale_issue'), c('unresolved_blocker')]);
    expect(outputs).toHaveLength(2);
    expect(outputs.find((o) => o.kind === 'notification')).toBeDefined();
    expect(outputs.find((o) => o.kind === 'action_required')).toBeDefined();
  });

  it('orphaned_issue routes as action_required', () => {
    const outputs = routeOutputs([c('orphaned_issue')]);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.kind).toBe('action_required');
  });
});

describe('conditionMessage', () => {
  it('stale_issue with staleHours:72 includes "3 day"', () => {
    const msg = conditionMessage(c('stale_issue', { staleHours: 72 }));
    expect(msg).toContain('3 day');
  });

  it('unresolved_blocker with blockerAgeHours:48 includes "2 day" and "Blocked"', () => {
    const msg = conditionMessage(c('unresolved_blocker', { blockerAgeHours: 48 }));
    expect(msg).toContain('2 day');
    expect(msg).toContain('Blocked');
  });

  it('orphaned_issue with orphanAgeDays:10 includes "10 day" and "No assignee"', () => {
    const msg = conditionMessage(c('orphaned_issue', { orphanAgeDays: 10 }));
    expect(msg).toContain('10 day');
    expect(msg).toContain('No assignee');
  });

  it('sprint_scope_creep includes "Added to"', () => {
    const msg = conditionMessage(c('sprint_scope_creep'));
    expect(msg).toContain('Added to');
  });
});

describe('conditionTitle', () => {
  it('uses issueTitle when present', () => {
    expect(conditionTitle(c('stale_issue', { issueTitle: 'Auth bug' }))).toBe('Auth bug');
  });

  it('falls back to projectTitle when no issueTitle', () => {
    expect(conditionTitle(c('stale_issue', { projectTitle: 'Backend' }))).toBe('Backend');
  });

  it('capacity_mismatch with projectTitle returns "Backend: capacity mismatch"', () => {
    expect(conditionTitle(c('capacity_mismatch', { projectTitle: 'Backend' }))).toBe('Backend: capacity mismatch');
  });

  it('returns "Untitled" when no issueTitle and no projectTitle', () => {
    expect(conditionTitle(c('stale_issue'))).toBe('Untitled');
  });
});
