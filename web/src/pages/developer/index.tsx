import { useState } from 'react';
import { AppsPage } from './AppsPage.js';
import { DeliveryLogPage } from './DeliveryLogPage.js';

type Tab = 'apps' | 'deliveries';

export function DeveloperPortal() {
  const [tab, setTab] = useState<Tab>('apps');
  const token = localStorage.getItem('ship_token') ?? '';

  return (
    <div>
      <nav style={{ display: 'flex', gap: 8, padding: '8px 24px', borderBottom: '1px solid #eee' }}>
        <strong>Developer Portal</strong>
        <button onClick={() => setTab('apps')} style={{ fontWeight: tab === 'apps' ? 'bold' : 'normal' }}>Apps</button>
        <button onClick={() => setTab('deliveries')} style={{ fontWeight: tab === 'deliveries' ? 'bold' : 'normal' }}>Delivery Log</button>
      </nav>
      {tab === 'apps' && <AppsPage />}
      {tab === 'deliveries' && <DeliveryLogPage token={token} />}
    </div>
  );
}
