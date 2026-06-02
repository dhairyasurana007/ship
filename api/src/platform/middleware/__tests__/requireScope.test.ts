import { describe, it, expect, vi } from 'vitest';
import { requireScope } from '../requireScope.js';

describe('requireScope middleware', () => {
  it('returns forbidden with the missing scope in details', () => {
    const next = vi.fn();
    const middleware = requireScope('documents:write');

    middleware({ auth: { scopes: ['documents:read'] } } as never, {} as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0] as { code?: string; message?: string; details?: { required?: string } };
    expect(error.code).toBe('forbidden');
    expect(error.message).toBe('Insufficient scope');
    expect(error.details?.required).toBe('documents:write');
  });
});
