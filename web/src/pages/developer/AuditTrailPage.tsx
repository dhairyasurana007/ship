import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

interface AuditEntry {
  client_id: string | null;
  user_id: string | null;
  route: string;
  scope_used: string | null;
  http_status: number;
  latency_ms: number | null;
  request_id: string | null;
  created_at: string;
}

export function AuditTrailPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  const load = async () => {
    const res = await apiGet('/api/v1/audit');
    if (res.ok) {
      const body = await res.json() as { data: AuditEntry[] };
      setEntries(body.data);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Audit Trail</h1>
      <button onClick={() => void load()}>Refresh</button>
      <table>
        <thead>
          <tr>
            <th>Route</th>
            <th>Scope</th>
            <th>Status</th>
            <th>Latency</th>
            <th>Request ID</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={`${entry.request_id ?? entry.created_at}-${entry.route}`}>
              <td>{entry.route}</td>
              <td>{entry.scope_used ?? '-'}</td>
              <td>{entry.http_status}</td>
              <td>{entry.latency_ms != null ? `${entry.latency_ms}ms` : '-'}</td>
              <td><code>{entry.request_id ?? '-'}</code></td>
              <td>{new Date(entry.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
