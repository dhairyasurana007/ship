import { describe, expect, it } from 'vitest';
import { inferToolCallFromPrompt } from '../fleetgraph/tools.js';

describe('fleetgraph tool intent inference', () => {
  it('infers delete action in document scope without explicit doc nouns', () => {
    const tool = inferToolCallFromPrompt({
      prompt: 'delete this',
      contextScope: 'document',
      documentId: 'doc-123',
    });

    expect(tool).toEqual({
      name: 'delete_document',
      args: { documentId: 'doc-123' },
    });
  });

  it('does not infer delete action in workspace scope without target', () => {
    const tool = inferToolCallFromPrompt({
      prompt: 'delete this',
      contextScope: 'workspace',
    });

    expect(tool).toBeNull();
  });

  it('infers workspace delete by quoted title', () => {
    const tool = inferToolCallFromPrompt({
      prompt: 'Delete all documents called "Untitled"',
      contextScope: 'workspace',
    });

    expect(tool).toEqual({
      name: 'delete_documents_by_title',
      args: { title: 'Untitled' },
    });
  });

  it('infers rename as title update in document scope', () => {
    const tool = inferToolCallFromPrompt({
      prompt: 'rename this to "Q2 launch plan"',
      contextScope: 'document',
      documentId: 'doc-456',
    });

    expect(tool).toEqual({
      name: 'update_document',
      args: {
        documentId: 'doc-456',
        title: 'Q2 launch plan',
      },
    });
  });

  it('infers create action with document type from prompt', () => {
    const tool = inferToolCallFromPrompt({
      prompt: 'create a new project "Mobile infra"',
      contextScope: 'workspace',
    });

    expect(tool).toEqual({
      name: 'create_document',
      args: {
        documentType: 'project',
        title: 'Mobile infra',
      },
    });
  });
});
