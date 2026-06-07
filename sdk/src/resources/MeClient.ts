import { ShipError } from '../errors.js';
import type { User } from '../types.js';

export class MeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async me(): Promise<User> {
    const res = await fetch(`${this.baseUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const body = await res.json() as any;
    if (!res.ok) {
      throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    }
    return body as User;
  }
}
