import { describe, expect, it, vi } from 'vitest';
import { buildDedupStateValue, evaluateDedup, type DedupStateValue } from '../fleetgraph/dedup-worsening.js';
import type { FleetGraphCondition } from '../fleetgraph/types.js';

function cond(type: FleetGraphCondition['type'], details: Record<string, unknown> = {}): FleetGraphCondition {
  return {
    type,
    severity: 'warning',
    entityId: 'i1',
    workspaceId: 'w1',
    details,
  };
}

describe('fleetgraph dedup/worsening', () => {
  it('suppresses repeat alert within 48h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const state = buildDedupStateValue('stale_issue', [cond('stale_issue', { staleHours: 25 })]);
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    const decision = evaluateDedup(state, [cond('stale_issue', { staleHours: 26 })]);
    expect(decision.shouldNotify).toBe(false);
    vi.useRealTimers();
  });

  it('bypasses suppression when condition set changes', () => {
    const state = buildDedupStateValue('stale_issue', [cond('stale_issue', { staleHours: 25 })]);
    const decision = evaluateDedup(state, [
      cond('stale_issue', { staleHours: 25 }),
      cond('unresolved_blocker', { blockerAgeHours: 50 }),
    ]);
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe('condition_change');
  });

  it('re-alerts when worsening threshold is crossed', () => {
    const state = buildDedupStateValue('unresolved_blocker', [cond('unresolved_blocker', { blockerAgeHours: 49 })]);
    const decision = evaluateDedup(state, [cond('unresolved_blocker', { blockerAgeHours: 72 })]);
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe('worsened');
  });

  it('stale issue re-alerts when crossing the next 24-hour bucket', () => {
    const state = buildDedupStateValue('stale_issue', [cond('stale_issue', { staleHours: 25 })]);
    const decision = evaluateDedup(state, [cond('stale_issue', { staleHours: 49 })]);
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe('worsened');
  });

  it('orphaned issue re-alerts when crossing the 7-day bucket', () => {
    const state = buildDedupStateValue('orphaned_issue', [cond('orphaned_issue', { orphanAgeDays: 7 })]);
    const decision = evaluateDedup(state, [cond('orphaned_issue', { orphanAgeDays: 14 })]);
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe('worsened');
  });

  it('scope creep re-alerts when post-start addition count increases', () => {
    // Manually build a prior state with scopeCreepCount=1 and dedupKey matching a single sprint_scope_creep condition.
    // Then evaluate with a single sprint_scope_creep condition — but override scopeCreepCount in state to simulate
    // that the previous notification was for fewer creep items than the aggregate now produces.
    const nextConditions = [cond('sprint_scope_creep')];
    const state: DedupStateValue = {
      dedupKey: 'sprint_scope_creep',
      lastNotifiedAt: new Date().toISOString(),
      scopeCreepCount: 0, // previously zero; now there is 1 — count increased
    };
    const decision = evaluateDedup(state, nextConditions);
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe('worsened');
  });
});

