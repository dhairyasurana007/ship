import type { FleetGraphCondition, FleetGraphIssueRecord } from './types.js';

const TERMINAL_STATES = new Set(['done', 'closed', 'cancelled']);

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

export function classifyConditions(issues: FleetGraphIssueRecord[]): FleetGraphCondition[] {
  const output: FleetGraphCondition[] = [];

  for (const issue of issues) {
    const ctx = {
      issueTitle: issue.title ?? undefined,
      assigneeId: issue.assigneeId ?? undefined,
      assigneeName: issue.assigneeName ?? undefined,
      projectTitle: issue.projectTitle ?? undefined,
      sprintTitle: issue.sprintTitle ?? undefined,
    };

    if (!TERMINAL_STATES.has((issue.state ?? '').toLowerCase()) && hoursSince(issue.updatedAt) >= 24) {
      output.push({
        type: 'stale_issue',
        severity: hoursSince(issue.updatedAt) >= 72 ? 'critical' : 'warning',
        entityId: issue.id,
        workspaceId: issue.workspaceId,
        details: { staleHours: Math.floor(hoursSince(issue.updatedAt)), ...ctx },
      });
    }

    if (!TERMINAL_STATES.has((issue.state ?? '').toLowerCase()) && !issue.projectId && !issue.sprintId) {
      const ageDays = Math.floor((Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      output.push({
        type: 'orphaned_issue',
        severity: ageDays >= 7 ? 'critical' : 'warning',
        entityId: issue.id,
        workspaceId: issue.workspaceId,
        details: { orphanAgeDays: ageDays, ...ctx },
      });
    }

    if (!TERMINAL_STATES.has((issue.state ?? '').toLowerCase()) && issue.hasBlockerText && issue.blockerUpdatedAt && hoursSince(issue.blockerUpdatedAt) >= 48) {
      output.push({
        type: 'unresolved_blocker',
        severity: hoursSince(issue.blockerUpdatedAt) >= 72 ? 'critical' : 'warning',
        entityId: issue.id,
        workspaceId: issue.workspaceId,
        details: { blockerAgeHours: Math.floor(hoursSince(issue.blockerUpdatedAt)), ...ctx },
      });
    }

    // Proxy for scope creep: issue added to sprint after 24h from issue creation.
    if (issue.sprintId && hoursSince(issue.createdAt) >= 24) {
      output.push({
        type: 'sprint_scope_creep',
        severity: 'info',
        entityId: issue.id,
        workspaceId: issue.workspaceId,
        details: { createdAt: issue.createdAt, sprintId: issue.sprintId, ...ctx },
      });
    }
  }

  return output;
}

/**
 * Cross-detection: find projects that have orphaned issues AND the project has
 * team members who aren't assigned to any active issue (capacity mismatch).
 */
export function classifyCapacityMismatch(issues: FleetGraphIssueRecord[]): FleetGraphCondition[] {
  const output: FleetGraphCondition[] = [];
  const TERMINAL = new Set(['done', 'closed', 'cancelled']);

  // Group by project
  const byProject = new Map<string, FleetGraphIssueRecord[]>();
  for (const issue of issues) {
    if (!issue.projectId) continue;
    const bucket = byProject.get(issue.projectId) ?? [];
    bucket.push(issue);
    byProject.set(issue.projectId, bucket);
  }

  for (const [projectId, projectIssues] of byProject) {
    const orphans = projectIssues.filter(
      (i) => !TERMINAL.has((i.state ?? '').toLowerCase()) && !i.sprintId && !i.assigneeId
    );
    if (orphans.length === 0) continue;

    // Find assignees active on this project
    const activeAssignees = new Set(
      projectIssues
        .filter((i) => !TERMINAL.has((i.state ?? '').toLowerCase()) && i.assigneeId)
        .map((i) => i.assigneeId!)
    );

    // All known team members in this project
    const allMembers = new Set(
      projectIssues.filter((i) => i.assigneeId).map((i) => i.assigneeId!)
    );

    const freeMembers = [...allMembers].filter((m) => !activeAssignees.has(m));
    if (freeMembers.length === 0) continue;

    const sample = orphans[0]!;
    output.push({
      type: 'capacity_mismatch',
      severity: 'info',
      entityId: projectId,
      workspaceId: sample.workspaceId,
      details: {
        orphanCount: orphans.length,
        freeMemberCount: freeMembers.length,
        projectTitle: sample.projectTitle ?? undefined,
      },
    });
  }

  return output;
}

