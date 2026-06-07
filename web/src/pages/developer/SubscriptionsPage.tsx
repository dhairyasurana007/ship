import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

interface Subscription {
  id: string;
  target_url: string;
  event_types: string[];
  enabled: boolean;
  created_at: string;
}

export function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [targetUrl, setTargetUrl] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const res = await apiGet('/api/v1/webhooks');
    if (res.ok) {
      const body = await res.json() as { data: Subscription[] };
      setSubscriptions(body.data);
    }
  };

  useEffect(() => { void load(); }, []);

  const createSubscription = async () => {
    if (!targetUrl.trim()) return;
    const res = await apiPost('/api/v1/webhooks', { target_url: targetUrl, event_types: ['document.created'] });
    if (!res.ok) {
      setError('Failed to create subscription');
      return;
    }
    setTargetUrl('');
    setError('');
    void load();
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>Webhook Subscriptions</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div style={{ marginBottom: 16 }}>
        <input
          value={targetUrl}
          onChange={(event) => setTargetUrl(event.target.value)}
          placeholder="https://example.com/webhooks/ship"
          style={{ width: 360, marginRight: 8 }}
        />
        <button onClick={() => void createSubscription()}>Create Subscription</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Target URL</th>
            <th>Events</th>
            <th>Enabled</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((subscription) => (
            <tr key={subscription.id}>
              <td>{subscription.target_url}</td>
              <td>{subscription.event_types.join(', ') || '-'}</td>
              <td>{subscription.enabled ? 'Yes' : 'No'}</td>
              <td>{new Date(subscription.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
