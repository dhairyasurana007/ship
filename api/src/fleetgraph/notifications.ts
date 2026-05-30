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
  const issueTitle = rawTitle && rawTitle.toLowerCase() !== 'untitled' ? rawTitle : null;
  const project = c.details?.projectTitle ? String(c.details.projectTitle) : null;

  // For capacity mismatch there's no single document — use project-level title
  if (c.type === 'capacity_mismatch') {
    return project
      ? `${project}: capacity mismatch`
      : 'Capacity mismatch';
  }

  // All other types: lead with the document title, fall back to project
  return issueTitle ?? project ?? 'Untitled issue';
}

function conditionMessage(c: FleetGraphCondition): string {
  const assignee = c.details?.assigneeName ? String(c.details.assigneeName) : null;
  const project = c.details?.projectTitle ? String(c.details.projectTitle) : null;
  const sprint = c.details?.sprintTitle ? String(c.details.sprintTitle) : null;
  const location = project && sprint ? `${project} · ${sprint}` : sprint ?? project ?? null;

  switch (c.type) {
    case 'stale_issue': {
      const hours = Number(c.details?.staleHours ?? 0);
      const days = Math.floor(hours / 24);
      const who = assignee ? `Assigned to ${assignee}.` : 'No assignee.';
      return location
        ? `Stale for ${days} day(s) in ${location}. ${who}`
        : `Stale for ${days} day(s). ${who}`;
    }
    case 'sprint_scope_creep': {
      const where = location ?? 'the sprint';
      return `Added to ${where} after the sprint start date.`;
    }
    case 'unresolved_blocker': {
      const bHours = Number(c.details?.blockerAgeHours ?? 0);
      const days = Math.floor(bHours / 24);
      const who = assignee ? `Assigned to ${assignee}.` : 'No assignee.';
      return location
        ? `Blocked for ${days} day(s) in ${location}. ${who}`
        : `Blocked for ${days} day(s). ${who}`;
    }
    case 'orphaned_issue': {
      const days = Number(c.details?.orphanAgeDays ?? 0);
      return location
        ? `No assignee and no sprint for ${days} day(s). Found in ${location}.`
        : `No assignee and no sprint for ${days} day(s).`;
    }
    case 'capacity_mismatch': {
      const orphans = Number(c.details?.orphanCount ?? 0);
      const free = Number(c.details?.freeMemberCount ?? 0);
      return `${free} member(s) are free but ${orphans} issue(s) are unassigned.`;
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
