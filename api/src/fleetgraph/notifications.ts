import type { FleetGraphCondition } from './types.js';

export interface FleetGraphOutputMessage {
  kind: 'notification' | 'action_required' | 'digest';
  title: string;
  message: string;
  conditions: string[];
}

const ACTION_REQUIRED = new Set(['unresolved_blocker', 'orphaned_issue']);

function conditionTitle(c: FleetGraphCondition): string {
  const rawTitle = c.details?.issueTitle ? String(c.details.issueTitle) : null;
  const issue = rawTitle && rawTitle.toLowerCase() !== 'untitled' ? `"${rawTitle}"` : null;
  const project = c.details?.projectTitle ? String(c.details.projectTitle) : null;
  const sprint = c.details?.sprintTitle ? String(c.details.sprintTitle) : null;

  // Build context suffix: always include both project and sprint when available
  const context = project && sprint
    ? ` — ${project} · ${sprint}`
    : sprint
    ? ` — ${sprint}`
    : project
    ? ` — ${project}`
    : '';

  switch (c.type) {
    case 'stale_issue': {
      const days = c.details?.staleHours ? Math.floor(Number(c.details.staleHours) / 24) : null;
      const age = days !== null ? ` (${days}d stale)` : '';
      return issue ? `${issue} is stale${age}${context}` : `Stale issue${age}${context}`;
    }
    case 'sprint_scope_creep':
      return issue
        ? `${issue} added to sprint late${context}`
        : sprint
        ? `Issue added to ${sprint} late${project ? ` — ${project}` : ''}`
        : project
        ? `Late sprint addition in ${project}`
        : 'Issue added to sprint after start';
    case 'unresolved_blocker':
      return issue ? `${issue} is blocked${context}` : `Unresolved blocker${context}`;
    case 'orphaned_issue':
      return issue ? `${issue} has no assignee or sprint${context}` : `Orphaned issue${context}`;
    case 'capacity_mismatch':
      return project
        ? `${String(c.details?.orphanCount ?? 0)} unassigned issues in ${project} — ${String(c.details?.freeMemberCount ?? 0)} member(s) free`
        : `Capacity mismatch: ${String(c.details?.orphanCount ?? 0)} unassigned, ${String(c.details?.freeMemberCount ?? 0)} free`;
    default:
      return (c.type as string).replace(/_/g, ' ');
  }
}

function conditionMessage(c: FleetGraphCondition): string {
  const assignee = c.details?.assigneeName ? ` Assigned to ${String(c.details.assigneeName)}.` : ' No assignee.';
  switch (c.type) {
    case 'stale_issue': {
      const hours = Number(c.details?.staleHours ?? 0);
      return `No state change in ${Math.floor(hours / 24)} day(s).${assignee}`;
    }
    case 'sprint_scope_creep':
      return `Issue added to sprint after start date.`;
    case 'unresolved_blocker': {
      const bHours = Number(c.details?.blockerAgeHours ?? 0);
      return `Blocked for ${Math.floor(bHours / 24)} day(s).${assignee}`;
    }
    case 'orphaned_issue': {
      const days = Number(c.details?.orphanAgeDays ?? 0);
      return `No assignee and no sprint for ${days} day(s).`;
    }
    case 'capacity_mismatch': {
      const orphans = Number(c.details?.orphanCount ?? 0);
      const free = Number(c.details?.freeMemberCount ?? 0);
      return `${free} team member(s) have no active issues but ${orphans} unassigned issue(s) exist in this project.`;
    }
    default:
      return 'See details.';
  }
}

export function routeOutputs(conditions: FleetGraphCondition[]): FleetGraphOutputMessage[] {
  const actionConditions = conditions.filter((c) => ACTION_REQUIRED.has(c.type));
  const notificationConditions = conditions.filter((c) => !ACTION_REQUIRED.has(c.type));

  const output: FleetGraphOutputMessage[] = [];

  for (const c of notificationConditions) {
    output.push({
      kind: 'notification',
      title: conditionTitle(c),
      message: conditionMessage(c),
      conditions: [c.type],
    });
  }

  for (const c of actionConditions) {
    output.push({
      kind: 'action_required',
      title: conditionTitle(c),
      message: conditionMessage(c),
      conditions: [c.type],
    });
  }

  return output;
}
