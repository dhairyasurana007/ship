import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { TokenStore } from '../auth/DeviceFlow.js';

interface TokenFile {
  token: string;
}

export class FileTokenStore implements TokenStore {
  constructor(
    private readonly filePath = path.join(os.homedir(), '.ship', 'token.json'),
  ) {}

  async load(): Promise<string | null> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(contents) as Partial<TokenFile>;
      return typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : null;
    } catch (error) {
      if (this.isMissingFile(error)) {
        return null;
      }

      throw error;
    }
  }

  async save(token: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify({ token }, null, 2)}\n`, 'utf8');
  }

  private isMissingFile(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: string }).code === 'ENOENT';
  }
}
