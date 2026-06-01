const SCOPES = [
  'documents:read',
  'documents:write',
  'issues:read',
  'issues:write',
  'sprints:read',
  'sprints:write',
  'webhooks:manage',
] as const;

export type Scope = typeof SCOPES[number];

class ScopeRegistryClass {
  private scopes = new Set<string>(SCOPES);
  all(): string[] { return [...this.scopes]; }
  isValid(scope: string): boolean { return this.scopes.has(scope); }
}

export const ScopeRegistry = new ScopeRegistryClass();
