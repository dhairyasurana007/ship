import type { FleetGraphCondition } from './types.js';

const SUPPRESS_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface DedupDecision {
  shouldNotify: boolean;
  dedupKey: string;
  reason: 'new' | 'suppressed' | 'condition_change' | 'worsened';
}

export interface DedupStateValue {
  dedupKey: string;
  lastNotifiedAt: string;
  worstStaleHours?: number;
  scopeCreepCount?: number;
  worstBlockerHours?: number;
  worstOrphanDays?: number;
}

function conditionSetKey(conditions: FleetGraphCondition[]): string {
  return conditions.map((c) => c.type).sort().join('|') || 'none';
}

function num(details: Record<string, unknown>, key: string): number {
  const v = details[key];
  return typeof v === 'number' ? v : 0;
}

function aggregate(conditions: FleetGraphCondition[]) {
  return {
    worstStaleHours: Math.max(0, ...conditions.filter((c) => c.type === 'stale_issue').map((c) => num(c.details, 'staleHours'))),
    scopeCreepCount: conditions.filter((c) => c.type === 'sprint_scope_creep').length,
    worstBlockerHours: Math.max(0, ...conditions.filter((c) => c.type === 'unresolved_blocker').map((c) => num(c.details, 'blockerAgeHours'))),
    worstOrphanDays: Math.max(0, ...conditions.filter((c) => c.type === 'orphaned_issue').map((c) => num(c.details, 'orphanAgeDays'))),
  };
}

function hasWorsened(previous: DedupStateValue, next: ReturnType<typeof aggregate>): boolean {
  if ((next.worstStaleHours ?? 0) >= (previous.worstStaleHours ?? 0) + 24) return true;
  if ((next.scopeCreepCount ?? 0) > (previous.scopeCreepCount ?? 0)) return true;
  if ((previous.worstBlockerHours ?? 0) < 48 && (next.worstBlockerHours ?? 0) >= 48) return true;
  if ((previous.worstBlockerHours ?? 0) < 72 && (next.worstBlockerHours ?? 0) >= 72) return true;
  if ((next.worstOrphanDays ?? 0) >= (previous.worstOrphanDays ?? 0) + 7) return true;
  return false;
}

export function evaluateDedup(previous: DedupStateValue | null, conditions: FleetGraphCondition[]): DedupDecision {
  const dedupKey = conditionSetKey(conditions);
  if (!previous) {
    return { shouldNotify: true, dedupKey, reason: 'new' };
  }

  if (previous.dedupKey !== dedupKey) {
    return { shouldNotify: true, dedupKey, reason: 'condition_change' };
  }

  const withinWindow = Date.now() - new Date(previous.lastNotifiedAt).getTime() < SUPPRESS_WINDOW_MS;
  const nextAgg = aggregate(conditions);
  if (hasWorsened(previous, nextAgg)) {
    return { shouldNotify: true, dedupKey, reason: 'worsened' };
  }

  if (withinWindow) {
    return { shouldNotify: false, dedupKey, reason: 'suppressed' };
  }

  return { shouldNotify: true, dedupKey, reason: 'new' };
}

export function buildDedupStateValue(dedupKey: string, conditions: FleetGraphCondition[]): DedupStateValue {
  const agg = aggregate(conditions);
  return {
    dedupKey,
    lastNotifiedAt: new Date().toISOString(),
    ...agg,
  };
}

