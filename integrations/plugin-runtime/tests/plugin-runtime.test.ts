import { describe, expect, it } from 'vitest';
import { runDocumentBeforeCreate } from '../index.js';

describe('plugin runtime', () => {
  it('runs the document.beforeCreate hook in isolation', async () => {
    const source = `
      registerPlugin({
        document: {
          beforeCreate(document) {
            return { ...document, title: String(document.title).trim() };
          }
        }
      });
    `;

    const result = await runDocumentBeforeCreate(source, { title: '  Untitled  ' });
    expect(result).toEqual({ title: 'Untitled' });
  });

  it('kills long-running plugins', async () => {
    const source = `
      registerPlugin({
        document: {
          beforeCreate() {
            const start = Date.now();
            while (Date.now() - start < 5_000) {}
            return { ok: true };
          }
        }
      });
    `;

    await expect(runDocumentBeforeCreate(source, { title: 'x' }, { timeoutMs: 100 })).rejects.toThrow(/timed out/i);
  });
});
