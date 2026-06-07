import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '@/lib/api';

interface Delivery {
  id: string; event_type: string; attempt_number: number;
  response_status: number | null; latency_ms: number | null;
  dead_lettered_at: string | null; created_at: string;
}

export function DeliveryLogPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [tab, setTab] = useState<'all' | 'dlq'>('all');

  const load = async () => {
    const res = await apiGet('/api/v1/webhooks/deliveries');
    if (res.ok) {
      const body = await res.json() as { data: Delivery[] };
      setDeliveries(body.data);
    }
  };

  useEffect(() => { void load(); }, []);

  const replay = async (id: string) => {
    await apiPost(`/api/v1/webhooks/deliveries/${id}/replay`);
    void load();
  };

  const rows = tab === 'dlq' ? deliveries.filter(d => d.dead_lettered_at) : deliveries;

  return (
    <div style={{ padding: 24 }}>
      <h1>Delivery Log</h1>
      <div>
        <button onClick={() => setTab('all')} style={{ fontWeight: tab === 'all' ? 'bold' : 'normal' }}>All</button>
        <button onClick={() => setTab('dlq')} style={{ fontWeight: tab === 'dlq' ? 'bold' : 'normal' }}>Dead Letters</button>
        <button onClick={() => void load()} style={{ marginLeft: 8 }}>Refresh</button>
      </div>
      <table>
        <thead>
          <tr><th>Event</th><th>Attempt</th><th>Status</th><th>Latency</th><th>DLQ</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map(d => (
            <tr key={d.id}>
              <td>{d.event_type}</td>
              <td>{d.attempt_number}</td>
              <td>{d.response_status ?? 'pending'}</td>
              <td>{d.latency_ms != null ? `${d.latency_ms}ms` : '-'}</td>
              <td>{d.dead_lettered_at ? '✓' : ''}</td>
              <td>{d.dead_lettered_at && <button onClick={() => void replay(d.id)}>Replay</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
