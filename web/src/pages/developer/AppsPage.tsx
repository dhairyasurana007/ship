import { useState, useEffect } from 'react';

interface App { id: string; name: string; client_id: string; created_at: string; }

export function AppsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const res = await fetch('/api/v1/apps');
    if (res.ok) setApps(await res.json() as App[]);
  };

  useEffect(() => { void load(); }, []);

  const createApp = async () => {
    if (!name.trim()) return;
    const res = await fetch('/api/v1/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, redirect_uris: [], scopes: ['documents:read'] }),
    });
    if (!res.ok) { setError('Failed to create app'); return; }
    const data = await res.json() as { id: string; client_secret: string };
    setSecret({ id: data.id, value: data.client_secret });
    setName('');
    setCreating(false);
    void load();
  };

  const rotateSecret = async (id: string) => {
    const res = await fetch(`/api/v1/apps/${id}/rotate`, { method: 'POST' });
    if (!res.ok) return;
    const data = await res.json() as { client_secret: string };
    setSecret({ id, value: data.client_secret });
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>OAuth Apps</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {secret && (
        <dialog open style={{ padding: 16, border: '1px solid #ccc' }}>
          <p><strong>Client Secret (shown once):</strong></p>
          <code>{secret.value}</code>
          <br /><br />
          <button onClick={() => setSecret(null)}>Close</button>
        </dialog>
      )}
      <button onClick={() => setCreating(true)}>Register App</button>
      {creating && (
        <div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="App name" />
          <button onClick={createApp}>Create</button>
          <button onClick={() => setCreating(false)}>Cancel</button>
        </div>
      )}
      <table>
        <thead><tr><th>Name</th><th>Client ID</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {apps.map(a => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td><code>{a.client_id}</code></td>
              <td>{new Date(a.created_at).toLocaleDateString()}</td>
              <td><button onClick={() => void rotateSecret(a.id)}>Rotate Secret</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
