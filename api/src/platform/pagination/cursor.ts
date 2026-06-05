/**
 * Opaque keyset cursor over { id, created_at }.
 * Encoded as base64url JSON — stable across reordering operations.
 */

export interface CursorPayload {
  id: string;
  created_at: string; // ISO-8601
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CursorPayload).id === 'string' &&
      typeof (parsed as CursorPayload).created_at === 'string'
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}
