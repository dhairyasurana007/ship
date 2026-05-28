import { describe, expect, it } from 'vitest';
import { buildSearchPlan } from '../fleetgraph/tools.js';

describe('fleetgraph search planner evals', () => {
  it('maps recent-created docs query to list strategy with created_at desc', () => {
    const plan = buildSearchPlan({ query: 'Find the most recent docs that were created' });
    expect(plan.strategy).toBe('list');
    expect(plan.timeField).toBe('created_at');
    expect(plan.sortDirection).toBe('desc');
    expect(plan.entityTypes).toContain('wiki');
    expect(plan.textQuery).toBe('');
  });

  it('maps oldest docs query to ascending sort', () => {
    const plan = buildSearchPlan({ query: 'show oldest documents' });
    expect(plan.strategy).toBe('list');
    expect(plan.sortDirection).toBe('asc');
    expect(plan.timeField).toBe('updated_at');
  });

  it('keeps meaningful text query and chooses hybrid strategy', () => {
    const plan = buildSearchPlan({ query: 'find doc with text asdfadf' });
    expect(plan.strategy).toBe('hybrid');
    expect(plan.textQuery).toContain('asdfadf');
  });

  it('infers issue entity type from query', () => {
    const plan = buildSearchPlan({ query: 'find issue related to payroll' });
    expect(plan.entityTypes).toContain('issue');
  });

  it('infers workspace entity type from query', () => {
    const plan = buildSearchPlan({ query: 'search workspace treasury' });
    expect(plan.entityTypes).toContain('workspace');
  });

  it('clamps limit high bound', () => {
    const plan = buildSearchPlan({ query: 'find projects', limit: 5000 });
    expect(plan.limit).toBe(50);
  });

  it('clamps limit low bound', () => {
    const plan = buildSearchPlan({ query: 'find projects', limit: -2 });
    expect(plan.limit).toBe(1);
  });

  it('defaults limit when non-numeric', () => {
    const plan = buildSearchPlan({ query: 'find projects', limit: 'abc' });
    expect(plan.limit).toBe(20);
  });

  it('respects explicit entityTypes filter', () => {
    const plan = buildSearchPlan({ query: 'find anything', entityTypes: ['project', 'sprint'] });
    expect(plan.entityTypes).toEqual(['project', 'sprint']);
  });

  it('drops unsupported entity types', () => {
    const plan = buildSearchPlan({ query: 'find anything', entityTypes: ['banana', 'project', 'unknown'] });
    expect(plan.entityTypes).toEqual(['project']);
  });
});

