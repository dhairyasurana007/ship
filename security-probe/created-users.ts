export interface CreatedProbeUser {
  email: string;
  source: 'auth-register' | 'auth-admin-create' | 'input-register' | 'ws-register' | 'ws-admin-create';
}

const createdProbeUsers: CreatedProbeUser[] = [];

export function registerCreatedProbeUser(user: CreatedProbeUser): void {
  createdProbeUsers.push({ email: user.email.toLowerCase(), source: user.source });
}

export function getCreatedProbeUsers(): CreatedProbeUser[] {
  return [...createdProbeUsers];
}

export function resetCreatedProbeUsers(): void {
  createdProbeUsers.length = 0;
}
