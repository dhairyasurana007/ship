import { describe, expect, it } from 'vitest';
import { routeOutputs } from '../fleetgraph/notifications.js';
import type { FleetGraphCondition } from '../fleetgraph/types.js';

function c(type: FleetGraphCondition['type']): FleetGraphCondition {
  return {
    type,
    severity: 'warning',
    entityId: 'i1',
    workspaceId: 'w1',
    details: {},
  };
}

describe('fleetgraph notification routing', () => {
  it('merges multiple notification-only conditions', () => {
    const outputs = routeOutputs([c('stale_issue'), c('sprint_scope_creep')]);
    const notifications = outputs.filter((o) => o.kind === 'notification');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.conditions).toEqual(['stale_issue', 'sprint_scope_creep']);
  });

  it('splits notification and action-required outputs', () => {
    const outputs = routeOutputs([c('stale_issue'), c('unresolved_blocker')]);
    expect(outputs.find((o) => o.kind === 'notification')).toBeDefined();
    expect(outputs.find((o) => o.kind === 'action_required')).toBeDefined();
  });
});
