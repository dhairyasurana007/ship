export type ShipErrorKind = 'auth' | 'rate_limit' | 'not_found' | 'validation' | 'server';

export class ShipError extends Error {
  constructor(
    public readonly kind: ShipErrorKind,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ShipError';
  }

  static fromResponse(code: string, message: string, details?: unknown, requestId?: string): ShipError {
    const kind: ShipErrorKind =
      code === 'unauthorized' ? 'auth'
      : code === 'forbidden' ? 'auth'
      : code === 'rate_limited' ? 'rate_limit'
      : code === 'not_found' ? 'not_found'
      : code === 'validation_failed' ? 'validation'
      : 'server';
    return new ShipError(kind, message, details, requestId);
  }
}
