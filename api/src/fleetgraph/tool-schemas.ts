/**
 * OpenAI-compatible tool definitions for FleetGraph.
 * The LLM uses these to select and parameterise tool calls.
 */

export const FLEETGRAPH_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'search_entities',
      description: 'Search or list documents, issues, projects, sprints, programs, wikis, or workspace info. Use for any read/lookup/count/list request.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for. Empty string to list all.' },
          entityTypes: {
            type: 'array',
            items: { type: 'string', enum: ['wiki', 'issue', 'project', 'program', 'sprint', 'standup', 'workspace'] },
            description: 'Entity types to filter by. Omit to search all types.',
          },
          limit: { type: 'number', description: 'Max results to return. Default 20.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_document',
      description: 'Create a new document (issue, wiki, project, sprint, program, standup).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the new document.' },
          documentType: { type: 'string', enum: ['issue', 'wiki', 'project', 'sprint', 'program', 'standup'], description: 'Type of document to create.' },
        },
        required: ['title', 'documentType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_document',
      description: 'Update the title or content of an existing document.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'ID of the document to update.' },
          title: { type: 'string', description: 'New title.' },
          content: { type: 'string', description: 'New content text.' },
        },
        required: ['documentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_document',
      description: 'Delete the current document by ID.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'ID of the document to delete.' },
        },
        required: ['documentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_documents_by_title',
      description: 'Delete all documents matching a given title (workspace scope).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title to match for deletion.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Create a new project.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Project title.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_project',
      description: 'Update an existing project title.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Project ID.' },
          title: { type: 'string', description: 'New title.' },
          targetTitle: { type: 'string', description: 'Current title to look up the project by (if no ID available).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'archive_project',
      description: 'Archive an existing project.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Project ID to archive.' },
        },
        required: ['documentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_sprint',
      description: 'Create a new sprint/week.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Sprint title.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_sprint',
      description: 'Close/complete the current sprint.',
      parameters: {
        type: 'object',
        properties: {
          sprintId: { type: 'string', description: 'Sprint document ID.' },
        },
        required: ['sprintId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_item_to_sprint',
      description: 'Move an issue to a specific sprint.',
      parameters: {
        type: 'object',
        properties: {
          issueTitle: { type: 'string', description: 'Title of the issue to move.' },
          targetSprintTitle: { type: 'string', description: 'Title of the target sprint.' },
        },
        required: ['issueTitle', 'targetSprintTitle'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_work_item_fields',
      description: 'Update status, assignee, or priority of an issue.',
      parameters: {
        type: 'object',
        properties: {
          issueTitle: { type: 'string', description: 'Title of the issue.' },
          status: { type: 'string', description: 'New status value.' },
        },
        required: ['issueTitle'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'link_documents',
      description: 'Link two documents together.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Source document ID.' },
          relatedId: { type: 'string', description: 'Target document ID.' },
          relationshipType: { type: 'string', description: 'Relationship type (parent, project, sprint, program).' },
        },
        required: ['documentId', 'relatedId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unlink_documents',
      description: 'Remove a link between two documents.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Source document ID.' },
          relatedId: { type: 'string', description: 'Target document ID.' },
          relationshipType: { type: 'string', description: 'Relationship type to remove.' },
        },
        required: ['documentId', 'relatedId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_comment',
      description: 'Add a comment to a document.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Document ID to comment on.' },
          content: { type: 'string', description: 'Comment text.' },
        },
        required: ['documentId', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_comment_thread',
      description: 'Summarize the comment thread on a document.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Document ID.' },
        },
        required: ['documentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_timeline_changes',
      description: 'Get the edit/change history timeline for a document.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_workspace_rules',
      description: 'Check workspace hygiene and validate project/sprint rules.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_sprint_review',
      description: 'Generate a review summary for a sprint.',
      parameters: {
        type: 'object',
        properties: {
          sprintTitle: { type: 'string', description: 'Sprint title to review.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_project_health_report',
      description: 'Generate a health report for a project.',
      parameters: {
        type: 'object',
        properties: {
          projectTitle: { type: 'string', description: 'Project title to report on.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_edit_documents',
      description: 'Bulk edit or archive multiple documents matching a title.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title pattern to match.' },
          setArchived: { type: 'boolean', description: 'Whether to archive matched documents.' },
        },
        required: ['title'],
      },
    },
  },
];
