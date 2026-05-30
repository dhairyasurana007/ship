import type { FleetGraphCondition, FleetGraphIssueRecord } from './types.js';

const TERMINAL_STATES = new Set(['done', 'closed', 'cancelled']);

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

export function classifyConditions(issues: FleetGraphIssueRecord[]): FleetGraphCondition[] {
  const output: FleetGraphCondition[] = [];

  for (const issue of issues) {
    if (!TERMINAL_STATES.has((issue.state ?? '').toLowerCase()) && hoursSince(issue.updatedAt) >= 24) {
      output.push({
        type: 'stale_issue',
        severity: hoursSince(issue.updatedAt) >= 72 ? 'critical' : 'warning',
        entityId: issue.id,
        workspaceId: issue.workspaceId,
        details: { staleHours: Math.floor(hoursSince(issue.updatedAt)) },
      });
    }

    if (!TERMINAL_STATES.has((issue.state ?? '').toLowerCase()) && !issue.projectId && !issue.sprintId) {
      const ageDays = Math.floor((Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      output.push({
        type: 'orphaned_issue',
        severity: ageDays >= 7 ? 'critical' : 'warning',
        entityId: issue.id,
        workspaceId: issue.workspaceId,
        details: { orphanAgeDays: ageDays },
      });
    }

    if (!TERMINAL_STATES.has((issue.state ?? '').toLowerCase()) && issue.hasBlockerText && issue.blockerUpdatedAt && hoursSince(issue.blockerUpdatedAt) >= 48) {
      output.push({
        type: 'unresolved_blocker',
        severity: hoursSince(issue.blockerUpdatedAt) >= 72 ? 'critical' : 'warning',
        entityId: issue.id,
        workspaceId: issue.workspaceId,
        details: { blockerAgeHours: Math.floor(hoursSince(issue.blockerUpdatedAt)) },
      });
    }

    // Proxy for scope creep: issue added to sprint after 24h from issue creation.
    if (issue.sprintId && hoursSince(issue.createdAt) >= 24) {
      output.push({
        type: 'sprint_scope_creep',
        severity: 'info',
        entityId: issue.id,
        workspaceId: issue.workspaceId,
        details: { createdAt: issue.createdAt, sprintId: issue.sprintId },
      });
    }
  }

  return output;
}

