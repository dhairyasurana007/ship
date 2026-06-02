/**
 * In-memory device code store (RFC 8628).
 * Sufficient for demo; replace with Redis/DB for production.
 */

export interface DeviceCodeEntry {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scope: string;
  expiresAt: Date;
  approved: boolean;
  userId: string | null;
  lastPolledAt: Date | null;
}

const store = new Map<string, DeviceCodeEntry>();

export const deviceStore = {
  set(deviceCode: string, entry: DeviceCodeEntry): void {
    store.set(deviceCode, entry);
  },

  getByDeviceCode(deviceCode: string): DeviceCodeEntry | undefined {
    return store.get(deviceCode);
  },

  getByUserCode(userCode: string): DeviceCodeEntry | undefined {
    for (const entry of store.values()) {
      if (entry.userCode === userCode) return entry;
    }
    return undefined;
  },

  approve(deviceCode: string, userId: string): void {
    const entry = store.get(deviceCode);
    if (entry) {
      entry.approved = true;
      entry.userId = userId;
    }
  },

  updateLastPolled(deviceCode: string): void {
    const entry = store.get(deviceCode);
    if (entry) entry.lastPolledAt = new Date();
  },

  delete(deviceCode: string): void {
    store.delete(deviceCode);
  },
};
