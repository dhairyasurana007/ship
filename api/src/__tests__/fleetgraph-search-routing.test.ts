import { describe, expect, it } from 'vitest';
import { buildSearchPlan, inferToolCallFromPrompt } from '../fleetgraph/tools.js';

describe('fleetgraph search routing evals', () => {
  it('routes latest project phrasing to search_entities', () => {
    const tool = inferToolCallFromPrompt({
      prompt: 'show latest projects',
      contextScope: 'workspace',
    });
    expect(tool?.name).toBe('search_entities');
  });

  it('routes oldest issues phrasing to search_entities', () => {
    const tool = inferToolCallFromPrompt({
      prompt: 'show oldest issues',
      contextScope: 'workspace',
    });
    expect(tool?.name).toBe('search_entities');
  });

  it('routes newest work items phrasing to search_entities', () => {
    const tool = inferToolCallFromPrompt({
      prompt: 'show newest work items',
      contextScope: 'workspace',
    });
    expect(tool?.name).toBe('search_entities');
  });

  it('routes direct phrase lookup to search_entities', () => {
    const tool = inferToolCallFromPrompt({
      prompt: 'find the document that contains this phrase: "sdfasdf"',
      contextScope: 'workspace',
    });
    expect(tool?.name).toBe('search_entities');
  });

  it('builds clean plan for recent created docs query', () => {
    const plan = buildSearchPlan({ query: 'Find the most recent docs that were created' });
    expect(plan.strategy).toBe('list');
    expect(plan.timeField).toBe('created_at');
    expect(plan.sortDirection).toBe('desc');
    expect(plan.textQuery).toBe('');
    expect(plan.entityTypes).toEqual(['wiki']);
  });

  it('builds hybrid plan for phrase search query', () => {
    const plan = buildSearchPlan({ query: 'find the document that contains this phrase: "sdfasdf"' });
    expect(plan.strategy).toBe('hybrid');
    expect(plan.entityTypes).toEqual(['wiki']);
    expect(plan.textQuery.toLowerCase()).toContain('sdfasdf');
  });
});

