import { describe, expect, it } from 'vitest';
import { inferToolCallFromPrompt } from '../fleetgraph/tools.js';

describe('fleetgraph tool matrix routing evals', () => {
  it('routes document CRUD tools', () => {
    expect(
      inferToolCallFromPrompt({ prompt: 'create document "A"', contextScope: 'workspace' })?.name
    ).toBe('create_document');
    expect(
      inferToolCallFromPrompt({ prompt: 'rename this to "B"', contextScope: 'document', documentId: 'doc-1' })?.name
    ).toBe('update_document');
    expect(
      inferToolCallFromPrompt({ prompt: 'delete this', contextScope: 'document', documentId: 'doc-1' })?.name
    ).toBe('delete_document');
    expect(
      inferToolCallFromPrompt({ prompt: 'delete all documents called "A"', contextScope: 'workspace' })?.name
    ).toBe('delete_documents_by_title');
  });

  it('routes project and sprint lifecycle tools', () => {
    expect(inferToolCallFromPrompt({ prompt: 'create project "P1"', contextScope: 'workspace' })?.name).toBe('create_project');
    expect(
      inferToolCallFromPrompt({ prompt: 'update project title to "P2"', contextScope: 'document', documentId: 'proj-1' })?.name
    ).toBe('update_project');
    expect(
      inferToolCallFromPrompt({ prompt: 'archive project', contextScope: 'document', documentId: 'proj-1' })?.name
    ).toBe('archive_project');
    expect(inferToolCallFromPrompt({ prompt: 'create sprint "S1"', contextScope: 'workspace' })?.name).toBe('create_sprint');
    expect(
      inferToolCallFromPrompt({ prompt: 'close sprint', contextScope: 'document', documentId: 'spr-1' })?.name
    ).toBe('close_sprint');
  });

  it('routes work-item mutation tools', () => {
    expect(
      inferToolCallFromPrompt({ prompt: 'move issue "I1" to sprint S1', contextScope: 'workspace' })?.name
    ).toBe('move_item_to_sprint');
    expect(
      inferToolCallFromPrompt({ prompt: 'set status to done for "I1"', contextScope: 'workspace' })?.name
    ).toBe('update_work_item_fields');
  });

  it('routes association tools', () => {
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    expect(inferToolCallFromPrompt({ prompt: `link document ${a} to ${b}`, contextScope: 'workspace' })?.name).toBe('link_documents');
    expect(inferToolCallFromPrompt({ prompt: `unlink document ${a} from ${b}`, contextScope: 'workspace' })?.name).toBe('unlink_documents');
  });

  it('routes search and read/report tools', () => {
    expect(inferToolCallFromPrompt({ prompt: 'find latest docs', contextScope: 'workspace' })?.name).toBe('search_entities');
    expect(inferToolCallFromPrompt({ prompt: 'search semantic planning notes', contextScope: 'workspace' })?.name).toBe('search_entities');
    expect(inferToolCallFromPrompt({ prompt: 'show timeline history', contextScope: 'workspace' })?.name).toBe('get_timeline_changes');
    expect(inferToolCallFromPrompt({ prompt: 'validate workspace rules', contextScope: 'workspace' })?.name).toBe('validate_workspace_rules');
    expect(inferToolCallFromPrompt({ prompt: 'sprint review "S1"', contextScope: 'workspace' })?.name).toBe('generate_sprint_review');
    expect(inferToolCallFromPrompt({ prompt: 'project health report "P1"', contextScope: 'workspace' })?.name).toBe('generate_project_health_report');
  });

  it('routes bulk edit and comment tools', () => {
    expect(inferToolCallFromPrompt({ prompt: 'bulk update "P1" archive', contextScope: 'workspace' })?.name).toBe('bulk_edit_documents');
    expect(
      inferToolCallFromPrompt({ prompt: 'add comment: "hello"', contextScope: 'document', documentId: 'doc-1' })?.name
    ).toBe('create_comment');
    expect(
      inferToolCallFromPrompt({ prompt: 'summarize comment thread', contextScope: 'document', documentId: 'doc-1' })?.name
    ).toBe('summarize_comment_thread');
  });
});

