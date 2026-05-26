import type { FleetGraphCondition } from './types.js';

export interface FleetGraphOutputMessage {
  kind: 'notification' | 'action_required' | 'digest';
  title: string;
  conditions: string[];
}

const ACTION_REQUIRED = new Set(['unresolved_blocker', 'orphaned_issue']);

export function routeOutputs(conditions: FleetGraphCondition[]): FleetGraphOutputMessage[] {
  const actionConditions = conditions.filter((c) => ACTION_REQUIRED.has(c.type));
  const notificationConditions = conditions.filter((c) => !ACTION_REQUIRED.has(c.type));

  const output: FleetGraphOutputMessage[] = [];
  if (notificationConditions.length > 0) {
    output.push({
      kind: 'notification',
      title: notificationConditions.length > 1 ? 'FleetGraph: Multiple findings' : `FleetGraph: ${notificationConditions[0]!.type}`,
      conditions: notificationConditions.map((c) => c.type),
    });
  }

  if (actionConditions.length > 0) {
    output.push({
      kind: 'action_required',
      title: actionConditions.length > 1 ? 'FleetGraph: Action required (multiple)' : `FleetGraph: Action required - ${actionConditions[0]!.type}`,
      conditions: actionConditions.map((c) => c.type),
    });
  }

  if (notificationConditions.length > 0 && actionConditions.length === 0) {
    output.push({
      kind: 'digest',
      title: 'FleetGraph: Daily digest candidate',
      conditions: notificationConditions.map((c) => c.type),
    });
  }

  return output;
}
